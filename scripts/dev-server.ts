/**
 * Local API server that mirrors Vercel's function routing (vercel.json rewrites),
 * so `npm run dev` works without the Vercel CLI. Production uses Vercel itself.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { ApiRequest, ApiResponse } from '../api/_lib/http.js';

type Handler = (req: ApiRequest, res: ApiResponse) => Promise<unknown>;

const routes: Array<{ pattern: RegExp; load: () => Promise<{ default: Handler }>; param?: string }> = [
  { pattern: /^\/api\/auth\/(me|signup|login|logout)$/, load: () => import('../api/auth.js'), param: 'action' },
  { pattern: /^\/api\/shares\/([^/]+)\/complete$/, load: () => import('../api/share-complete.js') },
  { pattern: /^\/api\/shares\/([^/]+)\/otp$/, load: () => import('../api/share-otp.js') },
  { pattern: /^\/api\/shares\/([^/]+)\/verify$/, load: () => import('../api/share-verify.js') },
  { pattern: /^\/api\/shares\/([^/]+)$/, load: () => import('../api/share.js') },
  { pattern: /^\/api\/shares$/, load: () => import('../api/shares.js') },
  { pattern: /^\/api\/cron\/cleanup$/, load: () => import('../api/cron/cleanup.js') },
  { pattern: /^\/api\/health$/, load: () => import('../api/health.js') },
];

const MAX_BODY = 1024 * 1024; // mirrors the spirit of Vercel's 4.5 MB cap; our JSON bodies are small

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new Error('Body too large');
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return undefined;
  if ((req.headers['content-type'] ?? '').includes('application/json')) {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  return raw;
}

export function decorate(req: IncomingMessage, res: ServerResponse, query: Record<string, string>, body: unknown) {
  const r = res as ApiResponse;
  r.status = (code: number) => {
    res.statusCode = code;
    return r;
  };
  r.json = (data: unknown) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(data));
    return r;
  };
  r.send = (data: unknown) => {
    res.end(typeof data === 'string' || Buffer.isBuffer(data) ? data : JSON.stringify(data));
    return r;
  };
  const q = req as ApiRequest;
  q.query = query;
  q.body = body;
  q.cookies = parseCookies(req.headers.cookie);
  return { req: q, res: r };
}

export function startDevServer(port: number) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const route = routes.find((r) => r.pattern.test(url.pathname));
    if (!route) {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: { code: 'not_found', message: 'No such endpoint.' } }));
      return;
    }
    const match = url.pathname.match(route.pattern)!;
    const query: Record<string, string> = Object.fromEntries(url.searchParams);
    if (match[1]) query[route.param ?? 'id'] = decodeURIComponent(match[1]);
    let body: unknown;
    try {
      body = await readBody(req);
    } catch {
      res.statusCode = 413;
      res.end();
      return;
    }
    const { req: q, res: r } = decorate(req, res, query, body);
    try {
      const mod = await route.load();
      await mod.default(q, r);
    } catch (err) {
      console.error('[dev-server]', err);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: { code: 'internal', message: 'Dev server error — see terminal.' } }));
      }
    }
  });
  return new Promise<typeof server>((resolve) => server.listen(port, () => resolve(server)));
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop()!)) {
  const port = Number(process.env.API_PORT ?? 3000);
  startDevServer(port).then(() => console.log(`API ready on http://localhost:${port}`));
}
