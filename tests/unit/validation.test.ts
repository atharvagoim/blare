import { describe, expect, it } from 'vitest';
import { createShareSchema, liveSharesSchema, loginSchema, sanitizeFileName, signupSchema, verifyPinSchema } from '../../api/_lib/validation.js';
import { MAX_FILE_BYTES, classifyFileName } from '../../shared/limits.js';

describe('createShareSchema', () => {
  it('applies defaults for a public text share', () => {
    const v = createShareSchema.parse({ type: 'text', text: 'hi' });
    expect(v).toMatchObject({ ttlSeconds: 300, visibility: 'public' });
  });
  it('accepts every listed expiry, including 10 minutes', () => {
    for (const ttlSeconds of [300, 600, 900, 3600, 86400]) {
      expect(createShareSchema.safeParse({ type: 'text', text: 'x', ttlSeconds }).success).toBe(true);
    }
  });
  it('rejects empty text, missing files and unknown expiry', () => {
    expect(createShareSchema.safeParse({ type: 'text', text: '   ' }).success).toBe(false);
    expect(createShareSchema.safeParse({ type: 'file' }).success).toBe(false);
    expect(createShareSchema.safeParse({ type: 'text', text: 'x', ttlSeconds: 999 }).success).toBe(false);
  });
  it('enforces the 500 MB limit', () => {
    const ok = createShareSchema.safeParse({ type: 'file', file: { name: 'a.zip', size: MAX_FILE_BYTES, mime: 'application/zip' } });
    const tooBig = createShareSchema.safeParse({ type: 'file', file: { name: 'a.zip', size: MAX_FILE_BYTES + 1, mime: 'application/zip' } });
    expect(ok.success).toBe(true);
    expect(tooBig.success).toBe(false);
  });
  it('limits files over 100 MB to 15 minutes', () => {
    const big = { name: 'a.zip', size: 200 * 1024 * 1024, mime: 'application/zip' };
    expect(createShareSchema.safeParse({ type: 'file', file: big, ttlSeconds: 15 * 60 }).success).toBe(true);
    expect(createShareSchema.safeParse({ type: 'file', file: big, ttlSeconds: 60 * 60 }).success).toBe(false);
    expect(createShareSchema.safeParse({ type: 'file', file: { ...big, size: 100 * 1024 * 1024 }, ttlSeconds: 60 * 60 }).success).toBe(true);
  });
  it('accepts private shares without any recipient list', () => {
    expect(createShareSchema.parse({ type: 'text', text: 'x', visibility: 'private', pin: '1234' }).visibility).toBe('private');
    expect(createShareSchema.safeParse({ type: 'text', text: 'x', visibility: 'secret', pin: '1234' }).success).toBe(false);
  });
});

describe('verifyPinSchema', () => {
  it('accepts exactly four digits', () => {
    expect(verifyPinSchema.safeParse({ pin: '0123' }).success).toBe(true);
    expect(verifyPinSchema.safeParse({ pin: '123' }).success).toBe(false);
    expect(verifyPinSchema.safeParse({ pin: '12345' }).success).toBe(false);
    expect(verifyPinSchema.safeParse({ pin: '12a4' }).success).toBe(false);
  });
});

describe('private shares', () => {
  it('need a 4-digit PIN chosen by the sender', () => {
    expect(createShareSchema.safeParse({ type: 'text', text: 'x', visibility: 'private' }).success).toBe(false);
    expect(createShareSchema.safeParse({ type: 'text', text: 'x', visibility: 'private', pin: '12' }).success).toBe(false);
    expect(createShareSchema.safeParse({ type: 'text', text: 'x', visibility: 'private', pin: '4821' }).success).toBe(true);
    expect(createShareSchema.safeParse({ type: 'text', text: 'x', visibility: 'public' }).success).toBe(true);
  });
});

describe('sanitizeFileName', () => {
  it('strips paths, control characters and leading dots', () => {
    expect(sanitizeFileName('../../etc/passwd.png')).toBe('passwd.png');
    expect(sanitizeFileName('C:\\Users\\me\\photo.jpg')).toBe('photo.jpg');
    expect(sanitizeFileName('a\u0000b"<c>.zip')).toBe('abc.zip');
    expect(sanitizeFileName('...hidden.png')).toBe('hidden.png');
    expect(sanitizeFileName('')).toBe('file');
  });
  it('truncates long names but keeps the extension', () => {
    const out = sanitizeFileName('x'.repeat(400) + '.flac');
    expect(out.length).toBe(200);
    expect(out.endsWith('.flac')).toBe(true);
  });
});

describe('classifyFileName', () => {
  it('maps extensions to kinds and rejects others', () => {
    expect(classifyFileName('a.JPG')).toEqual({ kind: 'image', mime: 'image/jpeg' });
    expect(classifyFileName('song.m4a')).toEqual({ kind: 'audio', mime: 'audio/mp4' });
    expect(classifyFileName('bundle.zip')).toEqual({ kind: 'zip', mime: 'application/zip' });
    expect(classifyFileName('icon.svg')).toBeNull();
    expect(classifyFileName('page.html')).toBeNull();
    expect(classifyFileName('noext')).toBeNull();
  });
});

describe('signupSchema', () => {
  const ok = { name: 'Atharva', email: 'a@b.co', password: 'correct-horse', confirmPassword: 'correct-horse' };
  it('accepts a valid sign-up', () => {
    expect(signupSchema.safeParse(ok).success).toBe(true);
  });
  it('rejects mismatched or short passwords, and bad emails', () => {
    expect(signupSchema.safeParse({ ...ok, confirmPassword: 'x' }).success).toBe(false);
    expect(signupSchema.safeParse({ ...ok, password: 'short', confirmPassword: 'short' }).success).toBe(false);
    expect(signupSchema.safeParse({ ...ok, email: 'nope' }).success).toBe(false);
    expect(signupSchema.safeParse({ ...ok, name: '  ' }).success).toBe(false);
  });
  it('login needs an email and a password', () => {
    expect(loginSchema.safeParse({ email: 'a@b.co', password: 'x' }).success).toBe(true);
    expect(loginSchema.safeParse({ email: 'a@b.co', password: '' }).success).toBe(false);
  });
});

describe('liveSharesSchema', () => {
  const id = 'A'.repeat(22);
  it('accepts a list of id + manage token pairs, or nothing', () => {
    expect(liveSharesSchema.parse({}).items).toEqual([]);
    expect(liveSharesSchema.safeParse({ items: [{ id, manageToken: 'tok' }] }).success).toBe(true);
  });
  it('rejects malformed ids and oversized lists', () => {
    expect(liveSharesSchema.safeParse({ items: [{ id: 'short', manageToken: 'tok' }] }).success).toBe(false);
    expect(liveSharesSchema.safeParse({ items: Array.from({ length: 51 }, () => ({ id, manageToken: 'tok' })) }).success).toBe(false);
  });
});
