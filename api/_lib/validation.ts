import { z } from 'zod';
import {
  ALLOWED_EXPIRY_SECONDS,
  DEFAULT_EXPIRY_SECONDS,
  LARGE_FILE_BYTES,
  LARGE_FILE_MAX_TTL_SECONDS,
  MAX_FILE_BYTES,
  MAX_TEXT_CHARS,
  OTP_LENGTH,
} from '../../shared/limits.js';

export const createShareSchema = z
  .object({
    type: z.enum(['text', 'file']),
    text: z.string().max(MAX_TEXT_CHARS, `Text can be at most ${MAX_TEXT_CHARS.toLocaleString('en-US')} characters.`).optional(),
    file: z
      .object({
        name: z.string().trim().min(1, 'File name is missing.').max(255, 'File name is too long.'),
        size: z
          .number()
          .int()
          .positive('The file is empty.')
          .max(MAX_FILE_BYTES, 'Files can be at most 500 MB.'),
        mime: z.string().max(100).default(''),
      })
      .optional(),
    ttlSeconds: z
      .number()
      .int()
      .default(DEFAULT_EXPIRY_SECONDS)
      .refine((v) => ALLOWED_EXPIRY_SECONDS.includes(v), 'Choose one of the listed expiry times.'),
    visibility: z.enum(['public', 'private']).default('public'),
    turnstileToken: z.string().max(4096).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.type === 'text' && (!v.text || v.text.trim().length === 0)) {
      ctx.addIssue({ code: 'custom', path: ['text'], message: 'Write some text to share.' });
    }
    if (v.type === 'file' && !v.file) {
      ctx.addIssue({ code: 'custom', path: ['file'], message: 'Choose a file to share.' });
    }
    if (v.type === 'file' && v.file && v.file.size > LARGE_FILE_BYTES && v.ttlSeconds > LARGE_FILE_MAX_TTL_SECONDS) {
      ctx.addIssue({
        code: 'custom',
        path: ['ttlSeconds'],
        message: `Files over ${LARGE_FILE_BYTES / 1024 / 1024} MB can only be shared for up to ${LARGE_FILE_MAX_TTL_SECONDS / 60} minutes.`,
      });
    }
  });
export type CreateShareInput = z.infer<typeof createShareSchema>;

export const verifyOtpSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(new RegExp(`^\\d{${OTP_LENGTH}}$`), `Enter the ${OTP_LENGTH}-digit PIN from the email.`),
});

/** Strip paths and control characters; keep the extension. */
export function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'file';
  const cleaned = base
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '');
  if (!cleaned) return 'file';
  if (cleaned.length <= 200) return cleaned;
  const dot = cleaned.lastIndexOf('.');
  const ext = dot > 0 && cleaned.length - dot <= 10 ? cleaned.slice(dot) : '';
  return cleaned.slice(0, 200 - ext.length) + ext;
}

// ---- Accounts ----

const accountEmail = z
  .string()
  .trim()
  .max(254, 'Email is too long.')
  .pipe(z.email({ message: 'Enter a valid email ID.' }));

const password = z
  .string()
  .min(8, 'Password must be at least 8 characters.')
  .max(200, 'Password is too long.');

export const signupSchema = z
  .object({
    name: z.string().trim().min(1, 'Enter your full name.').max(80, 'Name is too long.'),
    email: accountEmail,
    dob: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter your date of birth.')
      .refine((v) => {
        const d = new Date(`${v}T00:00:00Z`);
        return !Number.isNaN(d.getTime()) && d.getTime() < Date.now() && d.getUTCFullYear() >= 1900;
      }, 'Enter a valid date of birth.'),
    password,
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, { path: ['confirmPassword'], message: 'Passwords do not match.' });

export const loginSchema = z.object({
  email: accountEmail,
  password: z.string().min(1, 'Enter your password.').max(200),
});
