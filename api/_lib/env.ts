import { z } from 'zod';

// Files in api/_lib are not deployed as functions (Vercel ignores paths that start with "_").

const schema = z
  .object({
    MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
    R2_ACCOUNT_ID: z.string().optional(),
    R2_ACCESS_KEY_ID: z.string().min(1, 'R2_ACCESS_KEY_ID is required'),
    R2_SECRET_ACCESS_KEY: z.string().min(1, 'R2_SECRET_ACCESS_KEY is required'),
    R2_BUCKET: z.string().min(1, 'R2_BUCKET is required'),
    /** S3-compatible endpoint, e.g. https://s3.us-west-004.backblazeb2.com for Backblaze B2. Defaults to the R2 account endpoint. */
    R2_ENDPOINT: z.string().url().optional(),
    /** Signing region. Derived from a Backblaze endpoint when omitted; otherwise 'auto'. */
    S3_REGION: z.string().optional(),
    APP_SECRET: z.string().min(32, 'APP_SECRET must be at least 32 characters'),
    CRON_SECRET: z.string().min(16, 'CRON_SECRET must be at least 16 characters').optional(),
    APP_ORIGIN: z.string().optional(),
    EMAIL_PROVIDER: z.enum(['resend', 'smtp']).default('resend'),
    RESEND_API_KEY: z.string().optional(),
    SMTP_URL: z.string().optional(),
    EMAIL_FROM: z.string().optional(),
    TURNSTILE_SECRET_KEY: z.string().optional(),
    STORAGE_CAP_BYTES: z.coerce.number().int().positive().default(8 * 1024 ** 3),
    DAILY_UPLOAD_BYTES_PER_IP: z.coerce.number().int().positive().default(2 * 1024 ** 3),
    COOKIE_SECURE: z.enum(['true', 'false']).optional(),
  })
  .superRefine((v, ctx) => {
    // Presigned URLs carry the signature in the query string, so they must never travel over plain HTTP in production.
    const prod = v.COOKIE_SECURE ? v.COOKIE_SECURE === 'true' : process.env.VERCEL === '1';
    if (prod && v.R2_ENDPOINT && !v.R2_ENDPOINT.startsWith('https://')) {
      ctx.addIssue({ code: 'custom', path: ['R2_ENDPOINT'], message: 'R2_ENDPOINT must use https:// in production' });
    }
    if (!v.R2_ENDPOINT && !v.R2_ACCOUNT_ID) {
      ctx.addIssue({ code: 'custom', path: ['R2_ACCOUNT_ID'], message: 'R2_ACCOUNT_ID (or R2_ENDPOINT) is required' });
    }
  });

export type Env = z.infer<typeof schema> & { r2Endpoint: string; s3Region: string; secureCookies: boolean };

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  // Treat empty strings in .env files as "unset".
  const raw = Object.fromEntries(
    Object.entries(process.env).filter(([, v]) => v !== undefined && v !== ''),
  );
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid server configuration — ${details}`);
  }
  const v = parsed.data;
  const r2Endpoint = v.R2_ENDPOINT ?? `https://${v.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  cached = {
    ...v,
    r2Endpoint,
    s3Region: v.S3_REGION ?? /s3\.([a-z0-9-]+)\.backblazeb2\.com/.exec(r2Endpoint)?.[1] ?? 'auto',
    secureCookies: v.COOKIE_SECURE ? v.COOKIE_SECURE === 'true' : process.env.VERCEL === '1',
  };
  return cached;
}

/** For tests only. */
export function resetEnvCache(): void {
  cached = null;
}
