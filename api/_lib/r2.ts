import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  ListObjectVersionsCommand,
  PutObjectCommand,
  S3Client,
  type _Object,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from './env.js';

let client: S3Client | null = null;

function s3(): S3Client {
  if (client) return client;
  const e = env();
  client = new S3Client({
    // Backblaze B2 needs its real region (e.g. us-west-004); R2 accepts 'auto'.
    region: e.s3Region,
    endpoint: e.r2Endpoint,
    forcePathStyle: true,
    credentials: { accessKeyId: e.R2_ACCESS_KEY_ID, secretAccessKey: e.R2_SECRET_ACCESS_KEY },
    // Newer SDKs add CRC32 checksums by default, which breaks browser PUTs to presigned URLs.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
  return client;
}

const bucket = () => env().R2_BUCKET;

/**
 * Presigned PUT. Content-Type and Content-Length are signed headers, so the browser
 * must upload exactly the declared type and byte count or R2 rejects the request.
 */
export async function presignUpload(key: string, contentType: string, size: number, expiresIn: number) {
  const command = new PutObjectCommand({
    Bucket: bucket(),
    Key: key,
    ContentType: contentType,
    ContentLength: size,
  });
  const url = await getSignedUrl(s3(), command, {
    expiresIn,
    signableHeaders: new Set(['content-type', 'content-length']),
  });
  return { url, headers: { 'Content-Type': contentType } };
}

export function contentDisposition(type: 'inline' | 'attachment', fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

/** Presigned GET. `expiresIn` is always capped by the caller to the share's remaining life. */
export async function presignDownload(
  key: string,
  opts: { fileName: string; mime: string; disposition: 'inline' | 'attachment'; expiresIn: number },
) {
  const command = new GetObjectCommand({
    Bucket: bucket(),
    Key: key,
    ResponseContentType: opts.mime,
    ResponseContentDisposition: contentDisposition(opts.disposition, opts.fileName),
    ResponseCacheControl: 'private, no-store',
  });
  return getSignedUrl(s3(), command, { expiresIn: Math.max(1, Math.floor(opts.expiresIn)) });
}

export async function headObject(key: string): Promise<{ size: number } | null> {
  try {
    const out = await s3().send(new HeadObjectCommand({ Bucket: bucket(), Key: key }));
    return { size: out.ContentLength ?? 0 };
  } catch (err) {
    const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (status === 404) return null;
    throw err;
  }
}

export async function readHead(key: string, bytes: number): Promise<Uint8Array> {
  const out = await s3().send(new GetObjectCommand({ Bucket: bucket(), Key: key, Range: `bytes=0-${bytes - 1}` }));
  if (!out.Body) return new Uint8Array();
  return out.Body.transformToByteArray();
}

/**
 * Backblaze B2 keeps every version: a plain delete only writes a "hide marker" and the bytes keep
 * counting toward storage. So after the normal delete we also remove each remaining version and
 * marker by VersionId. Stores without versioning (R2, local S3) have nothing to remove.
 */
async function purgeVersions(key: string): Promise<void> {
  let keyMarker: string | undefined;
  let versionIdMarker: string | undefined;
  for (let page = 0; page < 20; page++) {
    const out = await s3().send(
      new ListObjectVersionsCommand({ Bucket: bucket(), Prefix: key, KeyMarker: keyMarker, VersionIdMarker: versionIdMarker }),
    );
    const found = [...(out.Versions ?? []), ...(out.DeleteMarkers ?? [])]
      .filter((v) => v.Key === key && v.VersionId && v.VersionId !== 'null')
      .map((v) => ({ Key: key, VersionId: v.VersionId! }));
    if (found.length > 0) {
      await s3().send(new DeleteObjectsCommand({ Bucket: bucket(), Delete: { Objects: found, Quiet: true } }));
    }
    if (!out.IsTruncated) return;
    keyMarker = out.NextKeyMarker;
    versionIdMarker = out.NextVersionIdMarker;
  }
}

export async function deleteObjects(keys: string[]): Promise<void> {
  for (let i = 0; i < keys.length; i += 1000) {
    const chunk = keys.slice(i, i + 1000);
    if (chunk.length === 0) continue;
    await s3().send(
      new DeleteObjectsCommand({
        Bucket: bucket(),
        Delete: { Objects: chunk.map((Key) => ({ Key })), Quiet: true },
      }),
    );
    // Best effort and in parallel: a store that can't list versions must not block the purge.
    await Promise.all(
      chunk.map((key) =>
        purgeVersions(key).catch((err) => {
          const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
          if (status !== 501 && status !== 404 && status !== 400) console.warn('[storage] could not purge old versions', status ?? err);
        }),
      ),
    );
  }
}

export async function listObjects(prefix: string, continuationToken?: string) {
  const out = await s3().send(
    new ListObjectsV2Command({ Bucket: bucket(), Prefix: prefix, ContinuationToken: continuationToken, MaxKeys: 1000 }),
  );
  return { objects: (out.Contents ?? []) as _Object[], next: out.IsTruncated ? out.NextContinuationToken : undefined };
}

/** For tests. */
export function resetR2Client(): void {
  client = null;
}
