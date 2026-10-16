import { env } from './env.js';
import { errors } from './http.js';

/** Cloudflare Turnstile (free) bot check. Only enforced when TURNSTILE_SECRET_KEY is set. */
export async function verifyTurnstile(token: string | undefined, ip: string): Promise<void> {
  const secret = env().TURNSTILE_SECRET_KEY;
  if (!secret) return;
  if (!token) throw errors.badRequest('Complete the verification check and try again.', 'captcha_required');
  const body = new URLSearchParams({ secret, response: token, remoteip: ip });
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body,
    signal: AbortSignal.timeout(6000),
  }).catch(() => null);
  const data = (await res?.json().catch(() => null)) as { success?: boolean } | null;
  if (!data?.success) throw errors.badRequest('Verification failed. Refresh the page and try again.', 'captcha_failed');
}
