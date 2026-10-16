import { randomBytes, scrypt as scryptCb, type ScryptOptions } from 'node:crypto';
import { hmac, randomId, safeEqual } from './crypto.js';
import { connectDb, User, type UserDoc } from './db.js';
import { env } from './env.js';
import { HttpError, errors, setCookie, type ApiResponse } from './http.js';
import { enforce } from './rateLimit.js';

export const SESSION_COOKIE = 'vanish_session';
const SESSION_DAYS = 30;

// ---- Passwords (scrypt, N=2^15) ----

const SCRYPT: ScryptOptions = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function scrypt(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scryptCb(password.normalize('NFKC'), salt, 64, SCRYPT, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt);
  return `scrypt$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, salt, key] = stored.split('$');
  if (algo !== 'scrypt' || !salt || !key) return false;
  const derived = await scrypt(password, Buffer.from(salt, 'base64url'));
  return safeEqual(derived.toString('base64url'), key);
}

// A real hash, so unknown emails take as long as wrong passwords.
let dummyHash: Promise<string> | null = null;
const getDummyHash = () => (dummyHash ??= hashPassword(randomBytes(16).toString('hex')));

// ---- Sessions: stateless signed cookie "userId.expiry.signature" ----

export function signSession(userId: string, now = Date.now()): { token: string; maxAge: number } {
  const maxAge = SESSION_DAYS * 24 * 60 * 60;
  const body = `${userId}.${Math.floor(now / 1000) + maxAge}`;
  return { token: `${body}.${hmac(env().APP_SECRET, 'session', body)}`, maxAge };
}

export function readSession(token: string | undefined, now = Date.now()): string | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [userId, exp, sig] = parts as [string, string, string];
  if (!safeEqual(sig, hmac(env().APP_SECRET, 'session', `${userId}.${exp}`))) return null;
  if (!/^\d+$/.test(exp) || Number(exp) * 1000 <= now) return null;
  return userId;
}

export function setSessionCookie(res: ApiResponse, userId: string) {
  const { token, maxAge } = signSession(userId);
  setCookie(res, SESSION_COOKIE, token, { maxAge, path: '/api', secure: env().secureCookies });
}

export function clearSessionCookie(res: ApiResponse) {
  setCookie(res, SESSION_COOKIE, '', { maxAge: 0, path: '/api', secure: env().secureCookies });
}

export async function currentUser(cookies: Record<string, string | undefined>): Promise<UserDoc | null> {
  const userId = readSession(cookies[SESSION_COOKIE]);
  if (!userId) return null;
  await connectDb();
  return User.findById(userId).lean<UserDoc>();
}

export function publicUser(u: UserDoc) {
  return { id: u._id, name: u.name, email: u.email };
}

// ---- Sign up / log in ----

export interface SignupInput {
  name: string;
  email: string;
  password: string;
}

export async function signup(input: SignupInput, ipHash: string): Promise<UserDoc> {
  await enforce('signup', ipHash, 5, 60 * 60, 'Too many sign-ups from this network. Try again later.');
  await connectDb();
  const email = input.email.trim().toLowerCase();
  if (await User.exists({ email })) {
    throw new HttpError(409, 'email_taken', 'An account with this email already exists. Log in instead.');
  }
  const user = {
    _id: randomId(),
    name: input.name.trim(),
    email,
    passwordHash: await hashPassword(input.password),
  };
  try {
    await User.create(user);
  } catch (err) {
    if ((err as { code?: number }).code === 11000) {
      throw new HttpError(409, 'email_taken', 'An account with this email already exists. Log in instead.');
    }
    throw err;
  }
  return (await User.findById(user._id).lean<UserDoc>())!;
}

export async function login(emailRaw: string, password: string, ipHash: string): Promise<UserDoc> {
  const email = emailRaw.trim().toLowerCase();
  await enforce('login-ip', ipHash, 10, 15 * 60, 'Too many login attempts. Wait a few minutes.');
  await enforce('login-email', hmac(env().APP_SECRET, 'login', email), 10, 15 * 60, 'Too many login attempts. Wait a few minutes.');
  await connectDb();
  const user = await User.findOne({ email }).lean<UserDoc>();
  const ok = await verifyPassword(password, user?.passwordHash ?? (await getDummyHash()));
  if (!user || !ok) throw errors.badRequest('Email or password is incorrect.', 'invalid_login');
  return user;
}
