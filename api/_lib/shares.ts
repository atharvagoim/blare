import {
  MAX_FILE_BYTES,
  PIN_MAX_ATTEMPTS,
  UPLOAD_WINDOW_SECONDS,
  classifyFileName,
  type CompleteShareResponse,
  type CreateShareResponse,
  type LiveShare,
  type LiveSharesResponse,
  type LockedShareView,
  type ShareView,
} from '../../shared/limits.js';
import {
  accessCookieName,
  decryptText,
  encryptText,
  hashPin,
  randomId,
  randomSecret,
  safeEqual,
  sha256,
  signAccessToken,
  verifyAccessToken,
} from './crypto.js';
import { connectDb, Share, type ShareDoc } from './db.js';
import { env } from './env.js';
import { HttpError, errors } from './http.js';
import { deleteObjects, headObject, listObjects, presignDownload, presignUpload, readHead } from './r2.js';
import { consume, enforce } from './rateLimit.js';
import { SIGNATURE_BYTES, canonicalMime, detectFileType } from './signature.js';
import { sanitizeFileName, type CreateShareInput } from './validation.js';

/** Mongo keeps expired docs this long (TTL backstop) so cleanup can still find their R2 keys. */
const PURGE_GRACE_MS = 3 * 24 * 60 * 60 * 1000;
/** Presigned GET URLs never outlive the share, and are short even for long-lived shares. */
const MAX_DOWNLOAD_URL_SECONDS = 300;

const LIMITS = {
  createPerIp: { limit: 10, window: 10 * 60 },
  viewPerIp: { limit: 120, window: 60 },
  pinVerifyPerIp: { limit: 15, window: 15 * 60 },
  deletePerIp: { limit: 30, window: 10 * 60 },
};

export interface RequestContext {
  ipHash: string;
  ip: string;
  /** Logged-in account, if any. */
  userId?: string | null;
  now?: Date;
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export async function createShare(input: CreateShareInput, ctx: RequestContext): Promise<CreateShareResponse> {
  const e = env();
  const now = ctx.now ?? new Date();
  await connectDb();
  await enforce('create', ctx.ipHash, LIMITS.createPerIp.limit, LIMITS.createPerIp.window, 'You are creating shares too quickly. Wait a few minutes.');

  // Opportunistic cleanup keeps storage tidy between daily cron runs. Never blocks creation.
  await sweepExpired(25, now).catch((err) => console.warn('[sweep] skipped', err));

  const id = randomId();
  const manageToken = randomSecret();

  const base = {
    _id: id,
    visibility: input.visibility,
    manageTokenHash: sha256(manageToken),
    ownerId: ctx.userId ?? undefined,
    pinHash: input.visibility === 'private' ? hashPin(e.APP_SECRET, id, input.pin!) : undefined,
    creatorIpHash: ctx.ipHash,
    ttlSeconds: input.ttlSeconds,
  };

  if (input.type === 'text') {
    const text = input.text!;
    const expiresAt = new Date(now.getTime() + input.ttlSeconds * 1000);
    await Share.create({
      ...base,
      kind: 'text',
      status: 'ready',
      textCiphertext: encryptText(e.APP_SECRET, text, id),
      textLength: text.length,
      readyAt: now,
      expiresAt,
      purgeAt: new Date(expiresAt.getTime() + PURGE_GRACE_MS),
    });
    return { id, manageToken, expiresAt: expiresAt.toISOString() };
  }

  // ---- file ----
  const file = input.file!;
  const fileName = sanitizeFileName(file.name);
  const classified = classifyFileName(fileName);
  if (!classified) {
    throw errors.badRequest('This file type is not supported. Share images, audio or ZIP files.', 'unsupported_type');
  }
  const declared = file.mime ? canonicalMime(file.mime) : '';
  if (declared && declared !== 'application/octet-stream' && declared.split('/')[0] !== classified.mime.split('/')[0]) {
    throw errors.badRequest('The file type does not match its extension.', 'type_mismatch');
  }
  if (file.size > MAX_FILE_BYTES) throw errors.badRequest('Files can be at most 500 MB.', 'too_large');

  const quota = await consume('upload-bytes', ctx.ipHash, e.DAILY_UPLOAD_BYTES_PER_IP, 24 * 60 * 60, file.size);
  if (!quota.allowed) {
    throw errors.tooMany(quota.retryAfter, 'You have reached the daily upload limit for this network. Try again tomorrow.');
  }

  const [usage] = await Share.aggregate<{ total: number }>([
    { $match: { expiresAt: { $gt: now }, size: { $gt: 0 } } },
    { $group: { _id: null, total: { $sum: '$size' } } },
  ]);
  if ((usage?.total ?? 0) + file.size > e.STORAGE_CAP_BYTES) {
    throw new HttpError(503, 'capacity', 'Storage is temporarily full. Try again in a few minutes.', { 'Retry-After': '300' });
  }

  const objectKey = `s/${id}/${randomSecret()}`;
  const uploadDeadline = new Date(now.getTime() + UPLOAD_WINDOW_SECONDS * 1000);
  await Share.create({
    ...base,
    kind: classified.kind,
    status: 'pending',
    objectKey,
    fileName,
    mime: classified.mime,
    size: file.size,
    expiresAt: uploadDeadline,
    purgeAt: new Date(uploadDeadline.getTime() + PURGE_GRACE_MS),
  });

  const upload = await presignUpload(objectKey, classified.mime, file.size, UPLOAD_WINDOW_SECONDS);
  return { id, manageToken, upload: { ...upload, expiresAt: uploadDeadline.toISOString() } };
}

// ---------------------------------------------------------------------------
// Complete (after the browser finished its direct PUT to R2)
// ---------------------------------------------------------------------------

export async function completeShare(id: string, manageToken: string | undefined, ctx: RequestContext): Promise<CompleteShareResponse> {
  const now = ctx.now ?? new Date();
  await connectDb();
  const share = await Share.findById(id).lean<ShareDoc>();
  if (!share || !manageToken || !safeEqual(share.manageTokenHash, sha256(manageToken))) throw errors.notFound();
  if (share.status === 'ready') return { id, expiresAt: share.expiresAt.toISOString() };
  if (share.status !== 'pending') throw errors.gone();
  if (share.expiresAt <= now) {
    await purgeShares([share]);
    throw errors.gone('The upload took too long and was discarded. Please try again.');
  }

  const reject = async (message: string, code: string) => {
    await purgeShares([share]);
    throw errors.badRequest(message, code);
  };

  const head = await headObject(share.objectKey!);
  if (!head) throw errors.badRequest('The upload has not finished yet.', 'upload_missing');
  if (head.size !== share.size || head.size > MAX_FILE_BYTES) {
    return reject('The uploaded file does not match the declared size.', 'size_mismatch');
  }

  const detected = detectFileType(await readHead(share.objectKey!, SIGNATURE_BYTES));
  if (!detected || detected.kind !== share.kind) {
    return reject('The file contents do not match a supported image, audio or ZIP format.', 'invalid_signature');
  }

  const expiresAt = new Date(now.getTime() + share.ttlSeconds * 1000);
  const updated = await Share.findOneAndUpdate(
    { _id: id, status: 'pending' },
    {
      $set: {
        status: 'ready',
        mime: detected.mime,
        readyAt: now,
        expiresAt,
        purgeAt: new Date(expiresAt.getTime() + PURGE_GRACE_MS),
      },
    },
    { returnDocument: 'after', lean: true },
  );
  if (!updated) throw errors.notFound();
  return { id, expiresAt: expiresAt.toISOString() };
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/** Loads a share that is ready and unexpired. Expired shares are purged on the spot. */
async function loadLiveShare(id: string, now: Date): Promise<ShareDoc> {
  await connectDb();
  const share = await Share.findById(id).lean<ShareDoc>();
  if (share?.status === 'expired') throw errors.gone();
  if (share?.status === 'deleted') throw new HttpError(410, 'deleted', 'This share was deleted by its owner.');
  if (!share || share.status !== 'ready') throw errors.notFound();
  if (share.expiresAt.getTime() <= now.getTime()) {
    await purgeShares([share], 'expired', now).catch((err) => console.warn('[purge] failed', err));
    throw errors.gone();
  }
  return share;
}

export async function getShareView(
  id: string,
  auth: { cookies: Record<string, string | undefined>; manageToken?: string },
  ctx: RequestContext,
): Promise<ShareView | LockedShareView> {
  const e = env();
  const now = ctx.now ?? new Date();
  await enforce('view', ctx.ipHash, LIMITS.viewPerIp.limit, LIMITS.viewPerIp.window);
  const share = await loadLiveShare(id, now);

  // The creating browser (manage token) and the owner account open private shares directly;
  // anyone else needs the PIN the sender chose.
  const isCreator = !!auth.manageToken && safeEqual(share.manageTokenHash, sha256(auth.manageToken));
  const isOwner = !!ctx.userId && share.ownerId === ctx.userId;
  const hasCookie = verifyAccessToken(e.APP_SECRET, auth.cookies[accessCookieName(id)], id, now.getTime());
  if (share.visibility === 'private' && !isCreator && !isOwner && !hasCookie) {
    return {
      id,
      locked: true,
      kind: share.kind,
      expiresAt: share.expiresAt.toISOString(),
      serverTime: now.toISOString(),
    };
  }

  const view: ShareView = {
    id,
    kind: share.kind,
    visibility: share.visibility,
    createdAt: (share.readyAt ?? share.createdAt).toISOString(),
    expiresAt: share.expiresAt.toISOString(),
    serverTime: now.toISOString(),
    canDelete: isCreator || isOwner,
  };

  if (share.kind === 'text') {
    view.text = decryptText(e.APP_SECRET, share.textCiphertext!, id);
    view.size = Buffer.byteLength(view.text, 'utf8');
    return view;
  }

  const remaining = Math.floor((share.expiresAt.getTime() - now.getTime()) / 1000);
  const expiresIn = Math.max(1, Math.min(remaining, MAX_DOWNLOAD_URL_SECONDS));
  const fileName = share.fileName ?? 'file';
  const mime = share.mime ?? 'application/octet-stream';
  view.fileName = fileName;
  view.size = share.size ?? 0;
  view.mime = mime;
  view.downloadUrl = await presignDownload(share.objectKey!, { fileName, mime, disposition: 'attachment', expiresIn });
  if (share.kind === 'image' || share.kind === 'audio') {
    view.previewUrl = await presignDownload(share.objectKey!, { fileName, mime, disposition: 'inline', expiresIn });
  }
  return view;
}

// ---------------------------------------------------------------------------
// Delete (creating browser or owner account)
// ---------------------------------------------------------------------------

export async function deleteShare(id: string, manageToken: string | undefined, ctx: RequestContext): Promise<void> {
  await enforce('delete', ctx.ipHash, LIMITS.deletePerIp.limit, LIMITS.deletePerIp.window);
  await connectDb();
  const share = await Share.findById(id).lean<ShareDoc>();
  const isCreator = !!share && !!manageToken && safeEqual(share.manageTokenHash, sha256(manageToken));
  const isOwner = !!share && !!ctx.userId && share.ownerId === ctx.userId;
  if (!share || (!isCreator && !isOwner)) throw errors.notFound();
  if (share.status === 'expired' || share.status === 'deleted') return; // already gone — idempotent
  await purgeShares([share], 'deleted');
}

// ---------------------------------------------------------------------------
// Private shares: a PIN the sender chose when creating the link
// ---------------------------------------------------------------------------

export async function verifyPin(id: string, pin: string, ctx: RequestContext): Promise<{ token: string; maxAge: number }> {
  const e = env();
  const now = ctx.now ?? new Date();
  await enforce('pin-verify-ip', ctx.ipHash, LIMITS.pinVerifyPerIp.limit, LIMITS.pinVerifyPerIp.window, 'Too many attempts. Wait a few minutes.');
  const share = await loadLiveShare(id, now);
  if (share.visibility !== 'private' || !share.pinHash) throw errors.badRequest('This share does not need a PIN.', 'not_private');

  // Count the attempt before comparing, atomically, so parallel guesses can't exceed the cap.
  // A 4-digit PIN has only 10,000 values, so the cap is what actually protects it.
  const attempt = await Share.findOneAndUpdate(
    { _id: id, status: 'ready', pinAttempts: { $lt: PIN_MAX_ATTEMPTS } },
    { $inc: { pinAttempts: 1 } },
    { returnDocument: 'after', lean: true, projection: { pinHash: 1, pinAttempts: 1 } },
  );
  if (!attempt) throw errors.badRequest('Too many wrong PINs. This link is locked; ask the sender for a new link.', 'pin_locked');

  if (!safeEqual(attempt.pinHash ?? '', hashPin(e.APP_SECRET, id, pin))) {
    const left = PIN_MAX_ATTEMPTS - (attempt.pinAttempts ?? PIN_MAX_ATTEMPTS);
    throw errors.badRequest(
      left > 0 ? `That PIN is not right. ${left} ${left === 1 ? 'try' : 'tries'} left.` : 'Too many wrong PINs. This link is locked; ask the sender for a new link.',
      left > 0 ? 'invalid_pin' : 'pin_locked',
    );
  }

  // Correct PIN: give back the attempts so a few earlier typos don't lock out the real recipient.
  await Share.updateOne({ _id: id }, { $set: { pinAttempts: 0 } });
  const token = signAccessToken(e.APP_SECRET, id, share.expiresAt);
  return { token, maxAge: (share.expiresAt.getTime() - now.getTime()) / 1000 };
}

// ---------------------------------------------------------------------------
// Live links: everything the caller can still manage (their account's, plus this browser's)
// ---------------------------------------------------------------------------

export async function listLiveShares(
  items: Array<{ id: string; manageToken: string }>,
  ctx: RequestContext,
): Promise<LiveSharesResponse> {
  const now = ctx.now ?? new Date();
  await enforce('view', ctx.ipHash, LIMITS.viewPerIp.limit, LIMITS.viewPerIp.window);
  await connectDb();

  const live = { status: 'ready' as const, expiresAt: { $gt: now } };
  const projection = { _id: 1, kind: 1, visibility: 1, readyAt: 1, createdAt: 1, expiresAt: 1, fileName: 1, size: 1, manageTokenHash: 1, ownerId: 1 };
  const [owned, byToken] = await Promise.all([
    ctx.userId ? Share.find({ ownerId: ctx.userId, ...live }, projection).sort({ expiresAt: 1 }).limit(100).lean<ShareDoc[]>() : [],
    items.length ? Share.find({ _id: { $in: items.map((i) => i.id) }, ...live }, projection).lean<ShareDoc[]>() : [],
  ]);

  const tokenById = new Map(items.map((i) => [i.id, i.manageToken]));
  const mine = new Map<string, ShareDoc>();
  for (const s of owned) mine.set(s._id, s);
  for (const s of byToken) {
    const token = tokenById.get(s._id);
    if (token && safeEqual(s.manageTokenHash, sha256(token))) mine.set(s._id, s);
  }

  const shares: LiveShare[] = [...mine.values()]
    .sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime())
    .slice(0, 100)
    .map((s) => ({
      id: s._id,
      kind: s.kind,
      visibility: s.visibility,
      createdAt: (s.readyAt ?? s.createdAt).toISOString(),
      expiresAt: s.expiresAt.toISOString(),
      fileName: s.fileName ?? undefined,
      size: s.size ?? undefined,
      canDelete: true,
    }));
  return { shares, serverTime: now.toISOString() };
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

type Purgeable = Pick<ShareDoc, '_id' | 'objectKey' | 'status'>;

/** How long a content-free tombstone lingers so dead links can say "expired" or "deleted". */
const TOMBSTONE_MS = 24 * 60 * 60 * 1000;

/**
 * Deletes R2 objects first, then strips every bit of content from the records.
 * Shares that were live become tombstones (status + timestamps only); unfinished
 * uploads are removed entirely.
 */
export async function purgeShares(shares: Purgeable[], reason: 'expired' | 'deleted' = 'expired', now = new Date()): Promise<number> {
  if (shares.length === 0) return 0;
  const keys = shares.map((s) => s.objectKey).filter((k): k is string => !!k);
  await deleteObjects(keys);
  const ids = shares.map((s) => s._id);
  const pending = shares.filter((s) => s.status === 'pending').map((s) => s._id);
  const live = shares.filter((s) => s.status !== 'pending').map((s) => s._id);
  await Promise.all([
    pending.length ? Share.deleteMany({ _id: { $in: pending } }) : null,
    live.length
      ? Share.updateMany(
          { _id: { $in: live } },
          {
            $set: { status: reason, purgeAt: new Date(now.getTime() + TOMBSTONE_MS) },
            $unset: { objectKey: 1, fileName: 1, mime: 1, size: 1, textCiphertext: 1, textLength: 1, pinHash: 1 },
          },
        )
      : null,
  ]);
  return ids.length;
}

export async function sweepExpired(limit: number, now = new Date()): Promise<number> {
  await connectDb();
  const expired = await Share.find({ expiresAt: { $lte: now }, status: { $in: ['pending', 'ready'] } }, { _id: 1, objectKey: 1, status: 1 })
    .sort({ expiresAt: 1 })
    .limit(limit)
    .lean<Purgeable[]>();
  return purgeShares(expired);
}

/** Removes R2 objects that have no live record (e.g. a record that hit the TTL backstop). */
export async function sweepOrphans(maxPages = 5, now = new Date()): Promise<number> {
  await connectDb();
  let token: string | undefined;
  let removed = 0;
  const minAgeMs = 60 * 60 * 1000;
  for (let page = 0; page < maxPages; page++) {
    const { objects, next } = await listObjects('s/', token);
    const old = objects.filter((o) => o.Key && o.LastModified && now.getTime() - o.LastModified.getTime() > minAgeMs);
    if (old.length > 0) {
      const keys = old.map((o) => o.Key!);
      const known = await Share.find({ objectKey: { $in: keys }, expiresAt: { $gt: now } }, { objectKey: 1 }).lean<Purgeable[]>();
      const live = new Set(known.map((s) => s.objectKey));
      const orphans = keys.filter((k) => !live.has(k));
      await deleteObjects(orphans);
      removed += orphans.length;
    }
    if (!next) break;
    token = next;
  }
  return removed;
}
