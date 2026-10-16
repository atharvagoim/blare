import type { IncomingMessage, ServerResponse } from 'node:http';
import { ZodError, type ZodType } from 'zod';
import { createHmac } from 'node:crypto';
import { env } from './env.js';

/**
 * Minimal request/response shape. Structurally compatible with @vercel/node's
 * VercelRequest/VercelResponse, and implemented by scripts/dev-server.ts locally.
 */
export type ApiRequest = IncomingMessage & {
  query: Record<string, string | string[] | undefined>;
  body?: unknown;
  cookies: Record<string, string | undefined>;
};
export type ApiResponse = ServerResponse & {
  status(code: number): ApiResponse;
  json(body: unknown): ApiResponse;
  send(body: unknown): ApiResponse;
};

type Method = 'GET' | 'POST' | 'DELETE';
type Handler = (req: ApiRequest, res: ApiResponse) => Promise<unknown> | unknown;

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public headers: Record<string, string> = {},
  ) {
    super(message);
  }
}

export const errors = {
  badRequest: (message: string, code = 'bad_request') => new HttpError(400, code, message),
  unauthorized: (message = 'Not authorized.') => new HttpError(401, 'unauthorized', message),
  forbidden: (message = 'Forbidden.') => new HttpError(403, 'forbidden', message),
  notFound: (message = 'This share does not exist.') => new HttpError(404, 'not_found', message),
  gone: (message = 'This share has expired.') => new HttpError(410, 'expired', message),
  tooMany: (retryAfter: number, message = 'Too many requests. Try again shortly.') =>
    new HttpError(429, 'rate_limited', message, { 'Retry-After': String(Math.max(1, Math.ceil(retryAfter))) }),
};

function setBaseHeaders(res: ApiResponse) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
}

function sendError(res: ApiResponse, status: number, code: string, message: string) {
  res.status(status).json({ error: { code, message } });
}

function allowedOrigins(): Set<string> {
  const set = new Set<string>();
  for (const o of (env().APP_ORIGIN ?? '').split(',')) if (o.trim()) set.add(o.trim().replace(/\/$/, ''));
  if (process.env.VERCEL_URL) set.add(`https://${process.env.VERCEL_URL}`);
  if (process.env.VERCEL_BRANCH_URL) set.add(`https://${process.env.VERCEL_BRANCH_URL}`);
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) set.add(`https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`);
  return set;
}

/** Browsers send Origin on cross-site POST/DELETE. Reject state changes from foreign sites. */
function checkOrigin(req: ApiRequest) {
  const origin = req.headers.origin;
  if (!origin) {
    // Some browsers omit Origin on same-site-ish requests; Fetch Metadata still tells us if it came from another site.
    if (req.headers['sec-fetch-site'] === 'cross-site') throw errors.forbidden('Requests from this origin are not allowed.');
    return;
  }
  const allowed = allowedOrigins();
  if (allowed.size === 0) return; // not configured (local dev)
  if (!allowed.has(origin)) throw errors.forbidden('Requests from this origin are not allowed.');
}

export function api(handlers: Partial<Record<Method, Handler>>) {
  return async function handler(req: ApiRequest, res: ApiResponse) {
    setBaseHeaders(res);
    const method = (req.method ?? 'GET').toUpperCase() as Method;
    const fn = handlers[method];
    if (!fn) {
      res.setHeader('Allow', Object.keys(handlers).join(', '));
      return sendError(res, 405, 'method_not_allowed', 'Method not allowed.');
    }
    try {
      if (method !== 'GET') checkOrigin(req);
      await fn(req, res);
    } catch (err) {
      if (err instanceof HttpError) {
        for (const [k, v] of Object.entries(err.headers)) res.setHeader(k, v);
        return sendError(res, err.status, err.code, err.message);
      }
      if (err instanceof ZodError) {
        const first = err.issues[0];
        return sendError(res, 400, 'invalid_input', first?.message ?? 'Invalid input.');
      }
      console.error('[api] unhandled error', err);
      return sendError(res, 500, 'internal', 'Something went wrong on our side. Please try again.');
    }
  };
}

export function parseBody<T>(req: ApiRequest, schema: ZodType<T>): T {
  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      throw errors.badRequest('Request body must be JSON.');
    }
  }
  return schema.parse(body ?? {});
}

export function queryParam(req: ApiRequest, name: string): string | undefined {
  const v = req.query[name];
  return Array.isArray(v) ? v[0] : v;
}

const SHARE_ID_RE = /^[A-Za-z0-9_-]{22}$/;
export function shareIdFrom(req: ApiRequest): string {
  const id = queryParam(req, 'id');
  if (!id || !SHARE_ID_RE.test(id)) throw errors.notFound();
  return id;
}

/** Client IP as seen by Vercel's edge (x-real-ip / x-forwarded-for are set by the platform). */
export function clientIp(req: ApiRequest): string {
  const real = req.headers['x-real-ip'];
  if (typeof real === 'string' && real) return real.trim();
  const fwd = req.headers['x-forwarded-for'];
  const first = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0]?.trim();
  return first || req.socket?.remoteAddress || 'unknown';
}

/** Logged-in account id from the session cookie, or null. */
export async function sessionUserId(req: ApiRequest): Promise<string | null> {
  const { readSession, SESSION_COOKIE } = await import('./auth.js');
  return readSession(req.cookies?.[SESSION_COOKIE]);
}

/** Everything share handlers need to know about the caller. */
export async function requestContext(req: ApiRequest) {
  return { ip: clientIp(req), ipHash: ipHash(req), userId: await sessionUserId(req) };
}

/** We never store raw IPs — only a keyed hash. */
export function ipHash(req: ApiRequest): string {
  return createHmac('sha256', env().APP_SECRET).update('ip:' + clientIp(req)).digest('base64url').slice(0, 22);
}

export function setCookie(
  res: ApiResponse,
  name: string,
  value: string,
  opts: { maxAge: number; path: string; secure: boolean },
) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${opts.path}`,
    `Max-Age=${Math.max(0, Math.floor(opts.maxAge))}`,
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (opts.secure) parts.push('Secure');
  const prev = res.getHeader('Set-Cookie');
  const list = Array.isArray(prev) ? prev : prev ? [String(prev)] : [];
  res.setHeader('Set-Cookie', [...list, parts.join('; ')]);
}
