import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

/** 128-bit URL-safe random id (22 chars). */
export function randomId(): string {
  return randomBytes(16).toString('base64url');
}

/** 256-bit URL-safe random secret (43 chars). */
export function randomSecret(): string {
  return randomBytes(32).toString('base64url');
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('base64url');
}

function deriveKey(secret: string, purpose: string): Buffer {
  return Buffer.from(hkdfSync('sha256', secret, 'vanish', purpose, 32));
}

export function hmac(secret: string, purpose: string, value: string): string {
  return createHmac('sha256', deriveKey(secret, 'hmac:' + purpose)).update(value).digest('base64url');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) {
    timingSafeEqual(ab, ab); // keep timing roughly constant
    return false;
  }
  return timingSafeEqual(ab, bb);
}

export function hashPin(secret: string, shareId: string, pin: string): string {
  return hmac(secret, 'pin', `${shareId}:${pin}`);
}

// ---- Text encryption at rest (AES-256-GCM) ----

export function encryptText(secret: string, plaintext: string, aad: string): string {
  const key = deriveKey(secret, 'text-encryption');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad));
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64url'), tag.toString('base64url'), data.toString('base64url')].join('.');
}

export function decryptText(secret: string, payload: string, aad: string): string {
  const [version, iv, tag, data] = payload.split('.');
  if (version !== 'v1' || !iv || !tag || data === undefined) throw new Error('Unsupported ciphertext');
  const key = deriveKey(secret, 'text-encryption');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
}

// ---- Access tokens for private shares (stored in an HttpOnly cookie) ----

interface AccessClaims {
  s: string; // share id
  e: number; // expiry, unix seconds
}

export function signAccessToken(secret: string, shareId: string, expiresAt: Date): string {
  const claims: AccessClaims = { s: shareId, e: Math.floor(expiresAt.getTime() / 1000) };
  const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${body}.${hmac(secret, 'access', body)}`;
}

export function verifyAccessToken(secret: string, token: string | undefined, shareId: string, now = Date.now()): boolean {
  if (!token) return false;
  const [body, sig] = token.split('.');
  if (!body || !sig) return false;
  if (!safeEqual(sig, hmac(secret, 'access', body))) return false;
  try {
    const claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as AccessClaims;
    return claims.s === shareId && typeof claims.e === 'number' && claims.e * 1000 > now;
  } catch {
    return false;
  }
}

export function accessCookieName(shareId: string): string {
  return `vanish_${shareId}`;
}
