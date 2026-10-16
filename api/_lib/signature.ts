import type { FileKind } from '../../shared/limits.js';

export interface DetectedType {
  kind: FileKind;
  mime: string;
}

/** Bytes needed from the start of an object for reliable detection. */
export const SIGNATURE_BYTES = 4096;

function startsWith(b: Uint8Array, sig: number[], offset = 0): boolean {
  if (b.length < offset + sig.length) return false;
  for (let i = 0; i < sig.length; i++) if (b[offset + i] !== sig[i]) return false;
  return true;
}

function ascii(b: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...b.subarray(offset, offset + length));
}

function isMp3Frame(b: Uint8Array, i: number): boolean {
  // 11-bit frame sync, MPEG version != reserved, layer III, bitrate/sample-rate not reserved
  if (b.length < i + 4) return false;
  if (b[i] !== 0xff || (b[i + 1]! & 0xe0) !== 0xe0) return false;
  const version = (b[i + 1]! >> 3) & 0x03;
  const layer = (b[i + 1]! >> 1) & 0x03;
  const bitrate = (b[i + 2]! >> 4) & 0x0f;
  const sampleRate = (b[i + 2]! >> 2) & 0x03;
  return version !== 0x01 && layer === 0x01 && bitrate !== 0x0f && bitrate !== 0 && sampleRate !== 0x03;
}

/**
 * Identify a file from its leading bytes. Only the formats this app accepts are
 * recognised; anything else (HTML, SVG, executables, PDFs …) returns null.
 */
export function detectFileType(b: Uint8Array): DetectedType | null {
  // ---- images ----
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { kind: 'image', mime: 'image/png' };
  if (startsWith(b, [0xff, 0xd8, 0xff])) return { kind: 'image', mime: 'image/jpeg' };
  if (ascii(b, 0, 6) === 'GIF87a' || ascii(b, 0, 6) === 'GIF89a') return { kind: 'image', mime: 'image/gif' };
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') return { kind: 'image', mime: 'image/webp' };

  // ISO-BMFF ("ftyp" box): AVIF images and M4A audio
  if (b.length >= 12 && ascii(b, 4, 4) === 'ftyp') {
    const brand = ascii(b, 8, 4);
    if (brand === 'avif' || brand === 'avis') return { kind: 'image', mime: 'image/avif' };
    if (['M4A ', 'M4B ', 'mp42', 'isom', 'mp41', 'dash', 'iso2'].includes(brand)) return { kind: 'audio', mime: 'audio/mp4' };
    return null;
  }

  // ---- audio ----
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WAVE') return { kind: 'audio', mime: 'audio/wav' };
  if (ascii(b, 0, 4) === 'OggS') return { kind: 'audio', mime: 'audio/ogg' };
  if (ascii(b, 0, 4) === 'fLaC') return { kind: 'audio', mime: 'audio/flac' };
  if (ascii(b, 0, 3) === 'ID3') return { kind: 'audio', mime: 'audio/mpeg' };
  // AAC ADTS: sync 0xFFF, layer bits 00
  if (b.length >= 2 && b[0] === 0xff && (b[1]! & 0xf6) === 0xf0) return { kind: 'audio', mime: 'audio/aac' };
  if (isMp3Frame(b, 0)) return { kind: 'audio', mime: 'audio/mpeg' };
  // WebM/Matroska (EBML). Only accepted as audio; DocType must be "webm".
  if (startsWith(b, [0x1a, 0x45, 0xdf, 0xa3])) {
    const head = ascii(b, 0, Math.min(b.length, 64));
    return head.includes('webm') ? { kind: 'audio', mime: 'audio/webm' } : null;
  }

  // ---- zip ----
  if (
    startsWith(b, [0x50, 0x4b, 0x03, 0x04]) || // local file header
    startsWith(b, [0x50, 0x4b, 0x05, 0x06]) // empty archive
  ) {
    return { kind: 'zip', mime: 'application/zip' };
  }

  return null;
}

/** Normalise MIME aliases browsers send so they can be compared to detected types. */
export function canonicalMime(mime: string): string {
  const m = mime.toLowerCase().split(';')[0]!.trim();
  const aliases: Record<string, string> = {
    'image/jpg': 'image/jpeg',
    'image/pjpeg': 'image/jpeg',
    'audio/mp3': 'audio/mpeg',
    'audio/x-wav': 'audio/wav',
    'audio/wave': 'audio/wav',
    'audio/vnd.wave': 'audio/wav',
    'audio/x-flac': 'audio/flac',
    'audio/x-m4a': 'audio/mp4',
    'audio/m4a': 'audio/mp4',
    'audio/x-aac': 'audio/aac',
    'audio/opus': 'audio/ogg',
    'application/x-zip-compressed': 'application/zip',
    'application/x-zip': 'application/zip',
    'multipart/x-zip': 'application/zip',
  };
  return aliases[m] ?? m;
}
