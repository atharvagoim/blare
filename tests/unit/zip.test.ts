import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { detectFileType } from '../../api/_lib/signature.js';
import { zipFiles } from '../../src/lib/zip.js';

describe('zipFiles', () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
  const files = [
    new File([png], 'a.png', { type: 'image/png' }),
    new File([png], 'a.png', { type: 'image/png' }), // duplicate name
    new File([new Uint8Array(300_000).fill(7)], 'song.mp3', { type: 'audio/mpeg' }),
  ];

  it('packs several files into one valid zip with every file intact', async () => {
    const zipped = await zipFiles(files);
    expect(zipped.name).toBe('blare-3-files.zip');
    expect(zipped.type).toBe('application/zip');
    const entries = unzipSync(new Uint8Array(await zipped.arrayBuffer()));
    expect(Object.keys(entries).sort()).toEqual(['a (2).png', 'a.png', 'song.mp3']);
    expect(Array.from(entries['a.png']!)).toEqual(Array.from(png));
    expect(entries['song.mp3']!.length).toBe(300_000);
  });

  it('is accepted by the server-side file type check', async () => {
    const zipped = await zipFiles(files);
    const head = new Uint8Array(await zipped.slice(0, 4096).arrayBuffer());
    expect(detectFileType(head)).toMatchObject({ kind: 'zip', mime: 'application/zip' });
  });

  it('reports progress up to 100%', async () => {
    const seen: number[] = [];
    await zipFiles(files, (p) => seen.push(p));
    expect(seen.at(-1)).toBeCloseTo(1, 5);
  });
});
