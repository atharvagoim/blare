import { describe, expect, it } from 'vitest';
import { createShareSchema, loginSchema, sanitizeFileName, signupSchema, verifyOtpSchema } from '../../api/_lib/validation.js';
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
    expect(createShareSchema.parse({ type: 'text', text: 'x', visibility: 'private' }).visibility).toBe('private');
    expect(createShareSchema.safeParse({ type: 'text', text: 'x', visibility: 'secret' }).success).toBe(false);
  });
});

describe('verifyOtpSchema', () => {
  it('accepts exactly six digits', () => {
    expect(verifyOtpSchema.safeParse({ code: '012345' }).success).toBe(true);
    expect(verifyOtpSchema.safeParse({ code: '12345' }).success).toBe(false);
    expect(verifyOtpSchema.safeParse({ code: '12345a' }).success).toBe(false);
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
  const ok = { name: 'Atharva', email: 'a@b.co', dob: '2000-01-15', password: 'correct-horse', confirmPassword: 'correct-horse' };
  it('accepts a valid sign-up', () => {
    expect(signupSchema.safeParse(ok).success).toBe(true);
  });
  it('rejects mismatched or short passwords, bad dates and bad emails', () => {
    expect(signupSchema.safeParse({ ...ok, confirmPassword: 'x' }).success).toBe(false);
    expect(signupSchema.safeParse({ ...ok, password: 'short', confirmPassword: 'short' }).success).toBe(false);
    expect(signupSchema.safeParse({ ...ok, dob: '2999-01-01' }).success).toBe(false);
    expect(signupSchema.safeParse({ ...ok, dob: '15/01/2000' }).success).toBe(false);
    expect(signupSchema.safeParse({ ...ok, email: 'nope' }).success).toBe(false);
    expect(signupSchema.safeParse({ ...ok, name: '  ' }).success).toBe(false);
  });
  it('login needs an email and a password', () => {
    expect(loginSchema.safeParse({ email: 'a@b.co', password: 'x' }).success).toBe(true);
    expect(loginSchema.safeParse({ email: 'a@b.co', password: '' }).success).toBe(false);
  });
});
