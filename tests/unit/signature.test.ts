import { describe, expect, it } from 'vitest';
import { canonicalMime, detectFileType } from '../../api/_lib/signature.js';

const bytes = (...parts: Array<number[] | string>) =>
  new Uint8Array(parts.flatMap((p) => (typeof p === 'string' ? [...Buffer.from(p, 'latin1')] : p)));

describe('detectFileType', () => {
  it.each([
    ['png', bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]), 'image', 'image/png'],
    ['jpeg', bytes([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]), 'image', 'image/jpeg'],
    ['gif', bytes('GIF89a', [1, 0]), 'image', 'image/gif'],
    ['webp', bytes('RIFF', [0, 0, 0, 0], 'WEBPVP8 '), 'image', 'image/webp'],
    ['avif', bytes([0, 0, 0, 0x1c], 'ftypavif'), 'image', 'image/avif'],
    ['wav', bytes('RIFF', [0, 0, 0, 0], 'WAVEfmt '), 'audio', 'audio/wav'],
    ['ogg', bytes('OggS', [0, 2]), 'audio', 'audio/ogg'],
    ['flac', bytes('fLaC', [0, 0, 0, 0x22]), 'audio', 'audio/flac'],
    ['mp3 id3', bytes('ID3', [4, 0, 0]), 'audio', 'audio/mpeg'],
    ['mp3 frame', bytes([0xff, 0xfb, 0x90, 0x64]), 'audio', 'audio/mpeg'],
    ['aac adts', bytes([0xff, 0xf1, 0x50, 0x80]), 'audio', 'audio/aac'],
    ['m4a', bytes([0, 0, 0, 0x20], 'ftypM4A ', [0, 0, 0, 0]), 'audio', 'audio/mp4'],
    ['webm audio', bytes([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01], 'B\x82\x84webm'), 'audio', 'audio/webm'],
    ['zip', bytes([0x50, 0x4b, 0x03, 0x04, 0x14, 0]), 'zip', 'application/zip'],
    ['empty zip', bytes([0x50, 0x4b, 0x05, 0x06]), 'zip', 'application/zip'],
  ])('recognises %s', (_name, input, kind, mime) => {
    expect(detectFileType(input)).toEqual({ kind, mime });
  });

  it.each([
    ['html', bytes('<!doctype html><script>alert(1)</script>')],
    ['svg', bytes('<svg xmlns="http://www.w3.org/2000/svg"></svg>')],
    ['pdf', bytes('%PDF-1.7')],
    ['elf', bytes([0x7f, 0x45, 0x4c, 0x46])],
    ['windows exe', bytes('MZ', [0x90, 0])],
    ['mp4 video brand', bytes([0, 0, 0, 0x20], 'ftypqt  ')],
    ['matroska video', bytes([0x1a, 0x45, 0xdf, 0xa3], 'B\x82\x88matroska')],
    ['empty', new Uint8Array()],
    ['truncated png', bytes([0x89, 0x50, 0x4e])],
  ])('rejects %s', (_name, input) => {
    expect(detectFileType(input)).toBeNull();
  });
});

describe('canonicalMime', () => {
  it('normalises browser aliases', () => {
    expect(canonicalMime('image/jpg')).toBe('image/jpeg');
    expect(canonicalMime('audio/x-m4a')).toBe('audio/mp4');
    expect(canonicalMime('application/x-zip-compressed')).toBe('application/zip');
    expect(canonicalMime('Audio/MPEG; charset=binary')).toBe('audio/mpeg');
  });
});
