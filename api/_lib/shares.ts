import {
  MAX_FILE_BYTES,
  OTP_MAX_ATTEMPTS,
  OTP_RESEND_COOLDOWN_SECONDS,
  OTP_TTL_SECONDS,
  UPLOAD_WINDOW_SECONDS,
  classifyFileName,
  type CompleteShareResponse,
  type CreateShareResponse,
  type LockedShareView,
  type ShareView,
} from '../../shared/limits.js';
import {
  accessCookieName,
  decryptText,
  encryptText,
  generateOtp,
  hashOtp,
  randomId,
  randomSecret,
  safeEqual,
  sha256,
  signAccessToken,
  verifyAccessToken,
} from './crypto.js';
import { connectDb, Otp, Share, User, type ShareDoc, type UserDoc } from './db.js';
import { sendOtpEmail } from './email.js';
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
  otpSendPerIp: { limit: 5, window: 15 * 60 },
  otpSendPerShare: { limit: 6, window: 60 * 60 },
  otpVerifyPerIp: { limit: 15, window: 15 * 60 },
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

  if (input.visibility === 'private' && !ctx.userId) {
    throw new HttpError(401, 'login_required', 'Log in to make a Private link.');
  }

  const id = randomId();
  const manageToken = randomSecret();

  const base = {
    _id: id,
    visibility: input.visibility,
    manageTokenHash: sha256(manageToken),
    ownerId: ctx.userId ?? undefined,
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
  // anyone else needs the PIN emailed to the owner.
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
// Private shares: one-time PIN emailed to the owner account
// ---------------------------------------------------------------------------

export async function requestOtp(
  id: string,
  shareUrl: string,
  ctx: RequestContext,
): Promise<{ message: string; cooldownSeconds: number }> {
  const e = env();
  const now = ctx.now ?? new Date();

  await enforce('otp-send-ip', ctx.ipHash, LIMITS.otpSendPerIp.limit, LIMITS.otpSendPerIp.window, 'Too many PIN requests. Wait a few minutes.');
  await enforce('otp-cooldown', id, 1, OTP_RESEND_COOLDOWN_SECONDS, 'Wait a minute before requesting another PIN.');

  const share = await loadLiveShare(id, now);
  if (share.visibility !== 'private') throw errors.badRequest('This share does not need a PIN.', 'not_private');
  const owner = share.ownerId ? await User.findById(share.ownerId, { email: 1 }).lean<Pick<UserDoc, 'email'>>() : null;
  if (!owner) throw errors.notFound();
  // Caps how often a leaked link can be used to email the owner.
  await enforce('otp-send-share', id, LIMITS.otpSendPerShare.limit, LIMITS.otpSendPerShare.window, 'Too many PINs were requested for this file.');

  const code = generateOtp();
  const expiresAt = new Date(Math.min(now.getTime() + OTP_TTL_SECONDS * 1000, share.expiresAt.getTime()));
  await Otp.updateOne(
    { _id: id },
    { $set: { shareId: id, codeHash: hashOtp(e.APP_SECRET, id, code), attempts: 0, expiresAt } },
    { upsert: true },
  );
  const minutes = Math.max(1, Math.round((expiresAt.getTime() - now.getTime()) / 60000));
  try {
    await sendOtpEmail({ to: owner.email, code, minutes, shareUrl });
  } catch (err) {
    await Otp.deleteOne({ _id: id });
    throw err;
  }
  return { message: 'PIN sent to the owner’s email.', cooldownSeconds: OTP_RESEND_COOLDOWN_SECONDS };
}

export async function verifyOtp(id: string, code: string, ctx: RequestContext): Promise<{ token: string; maxAge: number }> {
  const e = env();
  const now = ctx.now ?? new Date();
  await enforce('otp-verify-ip', ctx.ipHash, LIMITS.otpVerifyPerIp.limit, LIMITS.otpVerifyPerIp.window, 'Too many attempts. Wait a few minutes.');
  const share = await loadLiveShare(id, now);
  if (share.visibility !== 'private') throw errors.badRequest('This share does not need a PIN.', 'not_private');

  const invalid = () => errors.badRequest('That PIN is not valid. Check the email and try again.', 'invalid_code');

  // Count the attempt before comparing, atomically, so parallel guesses can't exceed the cap.
  const otp = await Otp.findOneAndUpdate(
    { _id: id, expiresAt: { $gt: now }, attempts: { $lt: OTP_MAX_ATTEMPTS } },
    { $inc: { attempts: 1 } },
    { returnDocument: 'after', lean: true },
  );
  if (!otp) throw invalid();

  if (!safeEqual(otp.codeHash, hashOtp(e.APP_SECRET, id, code))) {
    if (otp.attempts >= OTP_MAX_ATTEMPTS) {
      await Otp.deleteOne({ _id: id });
      throw errors.badRequest('Too many wrong PINs.', 'otp_locked');
    }
    throw invalid();
  }

  await Otp.deleteOne({ _id: id });
  const token = signAccessToken(e.APP_SECRET, id, share.expiresAt);
  return { token, maxAge: (share.expiresAt.getTime() - now.getTime()) / 1000 };
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
            $unset: { objectKey: 1, fileName: 1, mime: 1, size: 1, textCiphertext: 1, textLength: 1 },
          },
        )
      : null,
    Otp.deleteMany({ shareId: { $in: ids } }),
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
