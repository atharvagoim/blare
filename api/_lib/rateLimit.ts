import { connectDb, RateLimit } from './db.js';
import { errors } from './http.js';

export interface LimitResult {
  allowed: boolean;
  count: number;
  retryAfter: number; // seconds until the window resets
}

/**
 * Fixed-window counter stored in MongoDB (shared across all function instances).
 * `cost` lets the same mechanism meter bytes as well as requests.
 */
export async function consume(
  bucket: string,
  subject: string,
  limit: number,
  windowSeconds: number,
  cost = 1,
  now = Date.now(),
): Promise<LimitResult> {
  await connectDb();
  const windowMs = windowSeconds * 1000;
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const id = `${bucket}:${subject}:${windowStart}`;
  const expiresAt = new Date(windowStart + windowMs);

  const run = () =>
    RateLimit.findOneAndUpdate(
      { _id: id },
      { $inc: { count: cost }, $setOnInsert: { expiresAt } },
      { upsert: true, returnDocument: 'after', lean: true },
    );

  let doc;
  try {
    doc = await run();
  } catch (err) {
    // Two concurrent upserts can race on the unique _id; the retry hits the existing doc.
    if ((err as { code?: number }).code === 11000) doc = await run();
    else throw err;
  }
  const count = doc?.count ?? cost;
  return { allowed: count <= limit, count, retryAfter: (windowStart + windowMs - now) / 1000 };
}

/** Throws 429 when over the limit. */
export async function enforce(
  bucket: string,
  subject: string,
  limit: number,
  windowSeconds: number,
  message?: string,
): Promise<void> {
  const r = await consume(bucket, subject, limit, windowSeconds);
  if (!r.allowed) throw errors.tooMany(r.retryAfter, message);
}
