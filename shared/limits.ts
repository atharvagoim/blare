// Limits and enums shared by the browser and the API.
// This file must stay dependency-free: it is imported by both sides.

export const MAX_FILE_BYTES = 500 * 1024 * 1024; // 500 MB
/** Files above this size are "large": they may only live for LARGE_FILE_MAX_TTL_SECONDS. */
export const LARGE_FILE_BYTES = 100 * 1024 * 1024; // 100 MB
export const LARGE_FILE_MAX_TTL_SECONDS = 15 * 60;
export const MAX_TEXT_CHARS = 100_000;

/** Allowed lifetimes in seconds. The first entry is the default. */
export const EXPIRY_OPTIONS = [
  { seconds: 5 * 60, label: '5 minutes' },
  { seconds: 10 * 60, label: '10 minutes' },
  { seconds: 15 * 60, label: '15 minutes' },
  { seconds: 60 * 60, label: '1 hour' },
  { seconds: 24 * 60 * 60, label: '24 hours' },
] as const;
export const DEFAULT_EXPIRY_SECONDS = EXPIRY_OPTIONS[0].seconds;
export const ALLOWED_EXPIRY_SECONDS: readonly number[] = EXPIRY_OPTIONS.map((o) => o.seconds);

/** How long a browser has to finish its direct-to-storage upload before the pending share is purged. */
export const UPLOAD_WINDOW_SECONDS = 30 * 60;

export const OTP_LENGTH = 6;
export const OTP_TTL_SECONDS = 5 * 60;
export const OTP_RESEND_COOLDOWN_SECONDS = 60;
export const OTP_MAX_ATTEMPTS = 5;

export type ShareKind = 'text' | 'image' | 'audio' | 'zip';
export type FileKind = Exclude<ShareKind, 'text'>;

/** Extension → canonical MIME per kind. The server re-checks magic bytes after upload. */
export const ALLOWED_TYPES: Record<FileKind, Record<string, string>> = {
  image: {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    avif: 'image/avif',
  },
  audio: {
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
    oga: 'audio/ogg',
    opus: 'audio/ogg',
    flac: 'audio/flac',
    m4a: 'audio/mp4',
    aac: 'audio/aac',
    weba: 'audio/webm',
  },
  zip: {
    zip: 'application/zip',
  },
};

export function extensionOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i === -1 ? '' : name.slice(i + 1).toLowerCase();
}

/** Resolve the share kind and canonical MIME from a file name, or null if not allowed. */
export function classifyFileName(name: string): { kind: FileKind; mime: string } | null {
  const ext = extensionOf(name);
  for (const kind of Object.keys(ALLOWED_TYPES) as FileKind[]) {
    const mime = ALLOWED_TYPES[kind][ext];
    if (mime) return { kind, mime };
  }
  return null;
}

export const ACCEPT_ATTRIBUTE = Object.values(ALLOWED_TYPES)
  .flatMap((m) => Object.keys(m).map((e) => '.' + e))
  .join(',');

// ---- API contract ----

export interface CreateShareResponse {
  id: string;
  manageToken: string;
  /** Present for file shares: PUT the file here with the given headers. */
  upload?: { url: string; headers: Record<string, string>; expiresAt: string };
  /** Present for text shares (they are ready immediately). */
  expiresAt?: string;
}

export interface CompleteShareResponse {
  id: string;
  expiresAt: string;
}

export interface ShareView {
  id: string;
  kind: ShareKind;
  visibility: 'public' | 'private';
  createdAt: string;
  expiresAt: string;
  serverTime: string;
  fileName?: string;
  size?: number;
  mime?: string;
  text?: string;
  previewUrl?: string;
  downloadUrl?: string;
  /** True for the share's creator (this browser) or its owner account. */
  canDelete: boolean;
}

export interface LockedShareView {
  id: string;
  locked: true;
  kind: ShareKind;
  expiresAt: string;
  serverTime: string;
}

export interface ApiErrorBody {
  error: { code: string; message: string };
}
