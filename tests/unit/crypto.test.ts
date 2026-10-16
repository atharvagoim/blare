import { describe, expect, it } from 'vitest';
import {
  decryptText,
  encryptText,
  generateOtp,
  hashOtp,
  randomId,
  randomSecret,
  safeEqual,
  signAccessToken,
  verifyAccessToken,
} from '../../api/_lib/crypto.js';

const SECRET = 'unit-test-secret-unit-test-secret-0123456789';

describe('random tokens', () => {
  it('produces 128-bit ids and 256-bit secrets, URL-safe and unique', () => {
    const ids = new Set(Array.from({ length: 1000 }, randomId));
    expect(ids.size).toBe(1000);
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(randomSecret()).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});

describe('text encryption', () => {
  it('round-trips unicode text', () => {
    const msg = 'hello — 你好 — 🚀\nline two';
    const c = encryptText(SECRET, msg, 'share-a');
    expect(c).not.toContain('hello');
    expect(decryptText(SECRET, c, 'share-a')).toBe(msg);
  });
  it('fails when bound to a different share or key', () => {
    const c = encryptText(SECRET, 'secret', 'share-a');
    expect(() => decryptText(SECRET, c, 'share-b')).toThrow();
    expect(() => decryptText(SECRET + 'x', c, 'share-a')).toThrow();
  });
  it('detects tampering', () => {
    const c = encryptText(SECRET, 'secret', 'share-a');
    const parts = c.split('.');
    parts[3] = Buffer.from('tampered').toString('base64url');
    expect(() => decryptText(SECRET, parts.join('.'), 'share-a')).toThrow();
  });
});

describe('otp', () => {
  it('generates 6 digits', () => {
    for (let i = 0; i < 200; i++) expect(generateOtp()).toMatch(/^\d{6}$/);
  });
  it('hashes are scoped', () => {
    expect(hashOtp(SECRET, 'a', '123456')).not.toBe(hashOtp(SECRET, 'b', '123456'));
  });
});

describe('access tokens', () => {
  const exp = new Date(Date.now() + 60_000);
  it('verifies for the right share before expiry', () => {
    const t = signAccessToken(SECRET, 'share1', exp);
    expect(verifyAccessToken(SECRET, t, 'share1')).toBe(true);
  });
  it('rejects other shares, expiry, tampering, wrong key and garbage', () => {
    const t = signAccessToken(SECRET, 'share1', exp);
    expect(verifyAccessToken(SECRET, t, 'share2')).toBe(false);
    expect(verifyAccessToken(SECRET, t, 'share1', exp.getTime() + 1000)).toBe(false);
    const [body, sig] = t.split('.');
    const forged = Buffer.from(JSON.stringify({ s: 'share1', e: 9999999999 })).toString('base64url');
    expect(verifyAccessToken(SECRET, `${forged}.${sig}`, 'share1')).toBe(false);
    expect(verifyAccessToken(SECRET + 'x', `${body}.${sig}`, 'share1')).toBe(false);
    expect(verifyAccessToken(SECRET, 'garbage', 'share1')).toBe(false);
    expect(verifyAccessToken(SECRET, undefined, 'share1')).toBe(false);
  });
});

describe('safeEqual', () => {
  it('compares strings of any length', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});
