import { beforeAll, describe, expect, it } from 'vitest';

beforeAll(() => {
  Object.assign(process.env, {
    MONGODB_URI: 'mongodb://unused',
    R2_ENDPOINT: 'http://unused.local',
    R2_ACCESS_KEY_ID: 'x',
    R2_SECRET_ACCESS_KEY: 'x',
    R2_BUCKET: 'x',
    APP_SECRET: 'unit-test-secret-unit-test-secret-0123456789',
  });
});

describe('passwords', () => {
  it('hashes with a random salt and verifies', async () => {
    const { hashPassword, verifyPassword } = await import('../../api/_lib/auth.js');
    const a = await hashPassword('correct-horse');
    const b = await hashPassword('correct-horse');
    expect(a).not.toBe(b);
    expect(a).toMatch(/^scrypt\$/);
    expect(await verifyPassword('correct-horse', a)).toBe(true);
    expect(await verifyPassword('wrong-horse', a)).toBe(false);
    expect(await verifyPassword('correct-horse', 'garbage')).toBe(false);
  });
});

describe('sessions', () => {
  it('round-trips, expires and rejects tampering', async () => {
    const { signSession, readSession } = await import('../../api/_lib/auth.js');
    const { token } = signSession('user123');
    expect(readSession(token)).toBe('user123');
    expect(readSession(token, Date.now() + 31 * 24 * 3600 * 1000)).toBeNull();
    const [, exp, sig] = token.split('.');
    expect(readSession(`otheruser.${exp}.${sig}`)).toBeNull();
    expect(readSession(`user123.9999999999.${sig}`)).toBeNull();
    expect(readSession('nonsense')).toBeNull();
    expect(readSession(undefined)).toBeNull();
  });
});
