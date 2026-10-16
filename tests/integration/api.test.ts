/**
 * End-to-end API tests over real HTTP against a real MongoDB and an S3-compatible store.
 *
 *   TEST_MONGODB_URI=mongodb://127.0.0.1:27017/vanish-test \
 *   TEST_S3_ENDPOINT=http://127.0.0.1:4566 \
 *   npm run test:integration
 *
 * Skipped automatically when those variables are not set. Only email delivery is
 * intercepted (we capture the code instead of sending a real email).
 */
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const MONGO = process.env.TEST_MONGODB_URI;
const S3 = process.env.TEST_S3_ENDPOINT;
const enabled = !!MONGO && !!S3;

const sentEmails: Array<{ to: string; code: string }> = [];
vi.mock('../../api/_lib/email.js', () => ({
  sendOtpEmail: async (m: { to: string; code: string }) => {
    sentEmails.push({ to: m.to, code: m.code });
  },
}));

const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00,
  0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0a, 0x49,
  0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00,
  0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);

describe.skipIf(!enabled)('API (integration)', () => {
  let server: Server;
  let base: string;
  let db: typeof import('../../api/_lib/db.js');
  let ipCounter = 0;
  let ip = '';

  async function call(path: string, init: RequestInit & { json?: unknown } = {}) {
    const headers: Record<string, string> = { 'x-real-ip': ip, ...(init.headers as Record<string, string>) };
    if (init.json !== undefined) headers['content-type'] = 'application/json';
    const res = await fetch(base + path, {
      ...init,
      headers,
      body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
    });
    const text = await res.text();
    return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : undefined };
  }

  let ownerCounter = 0;
  async function signupOwner(email = `owner${++ownerCounter}-${Date.now()}@example.com`) {
    const res = await call('/api/auth/signup', {
      method: 'POST',
      json: { name: 'Atharva', email, dob: '2000-01-15', password: 'correct-horse', confirmPassword: 'correct-horse' },
    });
    expect(res.status).toBe(201);
    const cookie = res.headers.get('set-cookie')!.split(';')[0]!;
    return { email, session: cookie };
  }

  async function createFileShare(name: string, bytes: Uint8Array, extra: Record<string, unknown> = {}) {
    const created = await call('/api/shares', {
      method: 'POST',
      json: { type: 'file', file: { name, size: bytes.length, mime: '' }, ...extra },
    });
    expect(created.status).toBe(201);
    const put = await fetch(created.body.upload.url, { method: 'PUT', headers: created.body.upload.headers, body: bytes });
    expect(put.ok).toBe(true);
    return created.body as { id: string; manageToken: string };
  }

  beforeAll(async () => {
    Object.assign(process.env, {
      MONGODB_URI: MONGO,
      R2_ENDPOINT: S3,
      R2_ACCESS_KEY_ID: 'test',
      R2_SECRET_ACCESS_KEY: 'test',
      R2_BUCKET: `vanish-it-${Date.now()}`,
      APP_SECRET: 'integration-secret-integration-secret-0123',
      CRON_SECRET: 'integration-cron-secret',
      EMAIL_FROM: 'test@example.test',
      APP_ORIGIN: '',
    });
    const { S3Client, CreateBucketCommand } = await import('@aws-sdk/client-s3');
    await new S3Client({
      region: 'auto',
      endpoint: S3,
      forcePathStyle: true,
      credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
    }).send(new CreateBucketCommand({ Bucket: process.env.R2_BUCKET }));

    db = await import('../../api/_lib/db.js');
    await db.connectDb();
    await Promise.all([db.Share.deleteMany({}), db.Otp.deleteMany({}), db.RateLimit.deleteMany({})]);

    const { startDevServer } = await import('../../scripts/dev-server.js');
    server = await startDevServer(0);
    const addr = server.address();
    base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  });

  afterAll(async () => {
    server?.close();
    await db?.disconnectDb();
  });

  beforeEach(() => {
    ip = `10.0.0.${++ipCounter}`;
    sentEmails.length = 0;
  });

  it('creates, reads and deletes a text share', async () => {
    const created = await call('/api/shares', { method: 'POST', json: { type: 'text', text: 'hello there' } });
    expect(created.status).toBe(201);
    expect(created.body.id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    const ttl = new Date(created.body.expiresAt).getTime() - Date.now();
    expect(ttl).toBeGreaterThan(290_000);
    expect(ttl).toBeLessThanOrEqual(300_000);

    const stored = await db.Share.findById(created.body.id).lean();
    expect(stored?.textCiphertext).not.toContain('hello');

    const view = await call(`/api/shares/${created.body.id}`);
    expect(view.status).toBe(200);
    expect(view.body.text).toBe('hello there');
    expect(view.headers.get('cache-control')).toBe('no-store');

    const wrong = await call(`/api/shares/${created.body.id}`, { method: 'DELETE', headers: { 'x-manage-token': 'nope' } });
    expect(wrong.status).toBe(404);
    const del = await call(`/api/shares/${created.body.id}`, {
      method: 'DELETE',
      headers: { 'x-manage-token': created.body.manageToken },
    });
    expect(del.status).toBe(204);
    const after = await call(`/api/shares/${created.body.id}`);
    expect(after.status).toBe(410);
    expect(after.body.error.code).toBe('deleted');
    // The tombstone keeps no content.
    const tomb = await db.Share.findById(created.body.id).lean();
    expect(tomb).toMatchObject({ status: 'deleted' });
    expect(tomb?.textCiphertext).toBeUndefined();
  });

  it('denies access the moment a share expires and purges it', async () => {
    const { id, manageToken } = await createFileShare('pixel.png', PNG);
    const done = await call(`/api/shares/${id}/complete`, { method: 'POST', headers: { 'x-manage-token': manageToken } });
    expect(done.status).toBe(200);

    const key = (await db.Share.findById(id).lean())!.objectKey!;
    await db.Share.updateOne({ _id: id }, { $set: { expiresAt: new Date(Date.now() - 1) } });
    const view = await call(`/api/shares/${id}`);
    expect(view.status).toBe(410);
    expect(view.body.error.code).toBe('expired');
    // Content is gone; a tombstone remains so a refresh still says "expired" rather than "not found".
    const tomb = await db.Share.findById(id).lean();
    expect(tomb).toMatchObject({ status: 'expired' });
    expect(tomb?.objectKey).toBeUndefined();
    expect(tomb?.fileName).toBeUndefined();
    const again = await call(`/api/shares/${id}`);
    expect(again.status).toBe(410);
    expect(again.body.error.code).toBe('expired');
    const { headObject } = await import('../../api/_lib/r2.js');
    expect(await headObject(key)).toBeNull();
  });

  it('uploads a file directly to storage, validates it and serves short-lived URLs', async () => {
    const created = await call('/api/shares', {
      method: 'POST',
      json: { type: 'file', file: { name: 'pixel.png', size: PNG.length, mime: 'image/png' }, ttlSeconds: 900 },
    });
    expect(created.status).toBe(201);
    const { id, manageToken, upload } = created.body;
    const signed = new URL(upload.url).searchParams.get('X-Amz-SignedHeaders');
    expect(signed).toContain('content-length');
    expect(signed).toContain('content-type');

    // Not ready until completed.
    expect((await call(`/api/shares/${id}`)).status).toBe(404);
    await fetch(upload.url, { method: 'PUT', headers: upload.headers, body: PNG });

    const noAuth = await call(`/api/shares/${id}/complete`, { method: 'POST' });
    expect(noAuth.status).toBe(404);
    const done = await call(`/api/shares/${id}/complete`, { method: 'POST', headers: { 'x-manage-token': manageToken } });
    expect(done.status).toBe(200);
    expect(new Date(done.body.expiresAt).getTime() - Date.now()).toBeGreaterThan(890_000);

    const view = await call(`/api/shares/${id}`);
    expect(view.status).toBe(200);
    expect(view.body).toMatchObject({ kind: 'image', fileName: 'pixel.png', size: PNG.length, mime: 'image/png' });
    // Presigned GET never outlives 5 minutes, even for a 15-minute share.
    expect(Number(new URL(view.body.downloadUrl).searchParams.get('X-Amz-Expires'))).toBeLessThanOrEqual(300);
    const file = await fetch(view.body.downloadUrl);
    expect(file.status).toBe(200);
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(PNG);
  });

  it('caps download URL lifetime at the remaining share lifetime', async () => {
    const created = await call('/api/shares', { method: 'POST', json: { type: 'file', file: { name: 'p.png', size: PNG.length, mime: '' } } });
    const { id, manageToken, upload } = created.body;
    await fetch(upload.url, { method: 'PUT', headers: upload.headers, body: PNG });
    await call(`/api/shares/${id}/complete`, { method: 'POST', headers: { 'x-manage-token': manageToken } });
    await db.Share.updateOne({ _id: id }, { $set: { expiresAt: new Date(Date.now() + 7_000) } });
    const view = await call(`/api/shares/${id}`);
    expect(Number(new URL(view.body.previewUrl).searchParams.get('X-Amz-Expires'))).toBeLessThanOrEqual(7);
  });

  it('rejects files whose bytes do not match their type, and deletes them', async () => {
    const html = new TextEncoder().encode('<!doctype html><script>alert(1)</script>');
    const created = await call('/api/shares', { method: 'POST', json: { type: 'file', file: { name: 'evil.png', size: html.length, mime: 'image/png' } } });
    const { id, manageToken, upload } = created.body;
    await fetch(upload.url, { method: 'PUT', headers: upload.headers, body: html });
    const done = await call(`/api/shares/${id}/complete`, { method: 'POST', headers: { 'x-manage-token': manageToken } });
    expect(done.status).toBe(400);
    expect(done.body.error.code).toBe('invalid_signature');
    expect(await db.Share.findById(id).lean()).toBeNull();
  });

  it('rejects a ZIP disguised as an image', async () => {
    const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4]);
    const created = await call('/api/shares', { method: 'POST', json: { type: 'file', file: { name: 'x.jpg', size: zip.length, mime: '' } } });
    const { id, manageToken, upload } = created.body;
    await fetch(upload.url, { method: 'PUT', headers: upload.headers, body: zip });
    const done = await call(`/api/shares/${id}/complete`, { method: 'POST', headers: { 'x-manage-token': manageToken } });
    expect(done.body.error.code).toBe('invalid_signature');
  });

  it('rejects uploads whose size differs from what was declared', async () => {
    const created = await call('/api/shares', { method: 'POST', json: { type: 'file', file: { name: 'p.png', size: 5000, mime: '' } } });
    const { id, manageToken, upload } = created.body;
    await fetch(upload.url, { method: 'PUT', headers: upload.headers, body: PNG });
    const done = await call(`/api/shares/${id}/complete`, { method: 'POST', headers: { 'x-manage-token': manageToken } });
    expect(done.body.error.code).toBe('size_mismatch');
  });

  it('refuses unsupported types, mismatched MIME and oversized files before issuing an upload URL', async () => {
    const svg = await call('/api/shares', { method: 'POST', json: { type: 'file', file: { name: 'a.svg', size: 10, mime: 'image/svg+xml' } } });
    expect(svg.body.error.code).toBe('unsupported_type');
    const mismatch = await call('/api/shares', { method: 'POST', json: { type: 'file', file: { name: 'a.png', size: 10, mime: 'text/html' } } });
    expect(mismatch.body.error.code).toBe('type_mismatch');
    const big = await call('/api/shares', { method: 'POST', json: { type: 'file', file: { name: 'a.zip', size: 100 * 1024 * 1024 + 1, mime: '' } } });
    expect(big.status).toBe(400);
  });

  it('signs up, logs in, reports the session and logs out', async () => {
    const email = `atharva-${Date.now()}@Example.com`;
    const bad = await call('/api/auth/signup', {
      method: 'POST',
      json: { name: 'A', email, dob: '2000-01-15', password: 'correct-horse', confirmPassword: 'different' },
    });
    expect(bad.status).toBe(400);
    expect(bad.body.error.message).toBe('Passwords do not match.');

    const { session } = await signupOwner(email);
    const stored = await db.User.findOne({ email: email.toLowerCase() }).lean();
    expect(stored?.passwordHash).toMatch(/^scrypt\$/);
    expect(JSON.stringify(stored)).not.toContain('correct-horse');

    const dup = await call('/api/auth/signup', {
      method: 'POST',
      json: { name: 'A', email, dob: '2000-01-15', password: 'correct-horse', confirmPassword: 'correct-horse' },
    });
    expect(dup.status).toBe(409);

    const me = await call('/api/auth/me', { headers: { cookie: session } });
    expect(me.body.user).toMatchObject({ name: 'Atharva', email: email.toLowerCase() });
    expect((await call('/api/auth/me')).body.user).toBeNull();
    expect((await call('/api/auth/me', { headers: { cookie: session.replace(/.$/, 'x') } })).body.user).toBeNull();

    const wrong = await call('/api/auth/login', { method: 'POST', json: { email, password: 'nope-nope' } });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.code).toBe('invalid_login');
    const unknown = await call('/api/auth/login', { method: 'POST', json: { email: 'nobody@example.com', password: 'nope-nope' } });
    expect(unknown.body.error.message).toBe(wrong.body.error.message);

    const ok = await call('/api/auth/login', { method: 'POST', json: { email: email.toUpperCase(), password: 'correct-horse' } });
    expect(ok.status).toBe(200);
    const cookie = ok.headers.get('set-cookie')!;
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Path=/api');

    const out = await call('/api/auth/logout', { method: 'POST', json: {}, headers: { cookie: session } });
    expect(out.headers.get('set-cookie')).toContain('Max-Age=0');
  });

  it('rate limits login attempts', async () => {
    const statuses = [];
    for (let i = 0; i < 11; i++) {
      statuses.push((await call('/api/auth/login', { method: 'POST', json: { email: 'x@example.com', password: 'wrong-pass' } })).status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 400)).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  it('requires an account to create a private share', async () => {
    const res = await call('/api/shares', { method: 'POST', json: { type: 'text', text: 'x', visibility: 'private' } });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('login_required');
  });

  it('opens private shares only for the owner: their account, their browser, or the emailed PIN', async () => {
    const { email, session } = await signupOwner();
    const created = await call('/api/shares', {
      method: 'POST',
      headers: { cookie: session },
      json: { type: 'text', text: 'just for me', visibility: 'private' },
    });
    expect(created.status).toBe(201);
    const { id, manageToken } = created.body;

    // Anyone else with the link sees only that it's locked.
    const locked = await call(`/api/shares/${id}`);
    expect(locked.body).toMatchObject({ locked: true, kind: 'text' });
    expect(locked.body.text).toBeUndefined();

    // The owner's account opens it on any device; so does the creating browser.
    const asOwner = await call(`/api/shares/${id}`, { headers: { cookie: session } });
    expect(asOwner.body).toMatchObject({ text: 'just for me', canDelete: true });
    expect((await call(`/api/shares/${id}`, { headers: { 'x-manage-token': manageToken } })).body.text).toBe('just for me');

    // A different account is still locked out.
    const stranger = await signupOwner();
    expect((await call(`/api/shares/${id}`, { headers: { cookie: stranger.session } })).body.locked).toBe(true);

    // PIN goes to the owner's account email only; the request can't redirect it.
    const ask = await call(`/api/shares/${id}/otp`, { method: 'POST', json: { email: 'attacker@example.com' } });
    expect(ask.status).toBe(202);
    expect(JSON.stringify(ask.body)).not.toContain(email);
    expect(sentEmails).toEqual([{ to: email, code: expect.stringMatching(/^\d{6}$/) }]);
    const code = sentEmails[0]!.code;
    expect((await call(`/api/shares/${id}/otp`, { method: 'POST' })).status).toBe(429); // cooldown

    const bad = await call(`/api/shares/${id}/verify`, { method: 'POST', json: { code: code === '000000' ? '111111' : '000000' } });
    expect(bad.body.error.code).toBe('invalid_code');
    const good = await call(`/api/shares/${id}/verify`, { method: 'POST', json: { code } });
    expect(good.status).toBe(200);
    const access = good.headers.get('set-cookie')!.split(';')[0]!;
    const view = await call(`/api/shares/${id}`, { headers: { cookie: access } });
    expect(view.body).toMatchObject({ text: 'just for me', canDelete: false });

    // Single-use PIN; access cookie doesn't unlock any other share.
    expect((await call(`/api/shares/${id}/verify`, { method: 'POST', json: { code } })).status).toBe(400);
    const other = await call('/api/shares', { method: 'POST', headers: { cookie: session }, json: { type: 'text', text: 'other', visibility: 'private' } });
    const forged = access.replace(id, other.body.id);
    expect((await call(`/api/shares/${other.body.id}`, { headers: { cookie: forged } })).body.locked).toBe(true);

    // Visitors can't delete; the owner account can, from any device.
    expect((await call(`/api/shares/${id}`, { method: 'DELETE', headers: { cookie: stranger.session } })).status).toBe(404);
    expect((await call(`/api/shares/${id}`, { method: 'DELETE', headers: { cookie: session } })).status).toBe(204);
    expect((await call(`/api/shares/${id}`)).status).toBe(410);
  });

  it('keeps private file shares locked, including their download URLs', async () => {
    const { session } = await signupOwner();
    const created = await call('/api/shares', {
      method: 'POST',
      headers: { cookie: session },
      json: { type: 'file', file: { name: 'p.png', size: PNG.length, mime: '' }, visibility: 'private' },
    });
    const { id, manageToken, upload } = created.body;
    await fetch(upload.url, { method: 'PUT', headers: upload.headers, body: PNG });
    await call(`/api/shares/${id}/complete`, { method: 'POST', headers: { 'x-manage-token': manageToken } });
    const locked = await call(`/api/shares/${id}`);
    expect(locked.body.locked).toBe(true);
    expect(locked.body.downloadUrl).toBeUndefined();
    expect(locked.body.previewUrl).toBeUndefined();
  });

  it('locks the PIN after too many wrong guesses', async () => {
    const { session } = await signupOwner();
    const created = await call('/api/shares', { method: 'POST', headers: { cookie: session }, json: { type: 'text', text: 'x', visibility: 'private' } });
    const { id } = created.body;
    await call(`/api/shares/${id}/otp`, { method: 'POST' });
    const code = sentEmails[0]!.code;
    const wrong = code === '999999' ? '888888' : '999999';
    const codes = [];
    for (let i = 0; i < 5; i++) {
      codes.push((await call(`/api/shares/${id}/verify`, { method: 'POST', json: { code: wrong } })).body.error.code);
    }
    expect(codes.at(-1)).toBe('otp_locked');
    expect((await call(`/api/shares/${id}/verify`, { method: 'POST', json: { code } })).status).toBe(400);
  });

  it('marks public shares deletable only for their creator', async () => {
    const created = await call('/api/shares', { method: 'POST', json: { type: 'text', text: 'hi' } });
    const { id, manageToken } = created.body;
    expect((await call(`/api/shares/${id}`)).body.canDelete).toBe(false);
    expect((await call(`/api/shares/${id}`, { headers: { 'x-manage-token': manageToken } })).body.canDelete).toBe(true);
  });

  it('rate limits share creation per IP', async () => {
    const statuses = [];
    for (let i = 0; i < 11; i++) {
      statuses.push((await call('/api/shares', { method: 'POST', json: { type: 'text', text: `n${i}` } })).status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 201)).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  it('enforces the per-IP daily upload byte quota', async () => {
    process.env.DAILY_UPLOAD_BYTES_PER_IP = String(150 * 1024 * 1024);
    (await import('../../api/_lib/env.js')).resetEnvCache();
    const a = await call('/api/shares', { method: 'POST', json: { type: 'file', file: { name: 'a.zip', size: 90 * 1024 * 1024, mime: '' } } });
    const b = await call('/api/shares', { method: 'POST', json: { type: 'file', file: { name: 'b.zip', size: 90 * 1024 * 1024, mime: '' } } });
    expect(a.status).toBe(201);
    expect(b.status).toBe(429);
    delete process.env.DAILY_UPLOAD_BYTES_PER_IP;
    (await import('../../api/_lib/env.js')).resetEnvCache();
  });

  it('cron cleanup requires the secret and removes expired shares and their objects', async () => {
    expect((await call('/api/cron/cleanup')).status).toBe(401);
    expect((await call('/api/cron/cleanup', { headers: { authorization: 'Bearer wrong' } })).status).toBe(401);

    const created = await call('/api/shares', { method: 'POST', json: { type: 'file', file: { name: 'p.png', size: PNG.length, mime: '' } } });
    const { id, manageToken, upload } = created.body;
    await fetch(upload.url, { method: 'PUT', headers: upload.headers, body: PNG });
    await call(`/api/shares/${id}/complete`, { method: 'POST', headers: { 'x-manage-token': manageToken } });
    const key = (await db.Share.findById(id).lean())!.objectKey!;
    await db.Share.updateOne({ _id: id }, { $set: { expiresAt: new Date(Date.now() - 1000) } });

    const run = await call('/api/cron/cleanup', { headers: { authorization: 'Bearer integration-cron-secret' } });
    expect(run.status).toBe(200);
    expect(run.body.expiredRemoved).toBeGreaterThanOrEqual(1);
    expect(await db.Share.findById(id).lean()).toMatchObject({ status: 'expired' });
    expect((await db.Share.findById(id).lean())?.objectKey).toBeUndefined();
    const { headObject } = await import('../../api/_lib/r2.js');
    expect(await headObject(key)).toBeNull();
  });

  it('returns 404 for malformed ids and 405 for wrong methods', async () => {
    expect((await call('/api/shares/not-a-valid-id')).status).toBe(404);
    expect((await call('/api/shares', { method: 'GET' })).status).toBe(405);
  });

  it('rejects state changes from foreign origins when APP_ORIGIN is set', async () => {
    process.env.APP_ORIGIN = 'https://vanish.example';
    (await import('../../api/_lib/env.js')).resetEnvCache();
    const res = await call('/api/shares', {
      method: 'POST',
      headers: { origin: 'https://evil.example' },
      json: { type: 'text', text: 'x' },
    });
    expect(res.status).toBe(403);
    const ok = await call('/api/shares', {
      method: 'POST',
      headers: { origin: 'https://vanish.example' },
      json: { type: 'text', text: 'x' },
    });
    expect(ok.status).toBe(201);
    process.env.APP_ORIGIN = '';
    (await import('../../api/_lib/env.js')).resetEnvCache();
  });
});
