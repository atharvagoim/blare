import { Zip, ZipPassThrough } from 'fflate';

/** Rough size of the zip bookkeeping per file (local header + central directory entry + name). */
export const ZIP_OVERHEAD_PER_FILE = 256;

/** "a.png", "a (2).png", "a (3).png": zip entries must have unique names. */
function uniqueNames(files: File[]): string[] {
  const seen = new Map<string, number>();
  return files.map((f) => {
    const clean = f.name.replace(/[\\/]/g, '_') || 'file';
    const n = (seen.get(clean) ?? 0) + 1;
    seen.set(clean, n);
    if (n === 1) return clean;
    const dot = clean.lastIndexOf('.');
    return dot > 0 ? `${clean.slice(0, dot)} (${n})${clean.slice(dot)}` : `${clean} (${n})`;
  });
}

/**
 * Packs several files into one stored (uncompressed) .zip in the browser, so a single link can carry
 * many files. Images, audio and zips are already compressed, so storing is fast and costs nothing.
 */
export async function zipFiles(files: File[], onProgress?: (fraction: number) => void): Promise<File> {
  const names = uniqueNames(files);
  const total = files.reduce((n, f) => n + f.size, 0) || 1;
  const parts: Uint8Array[] = [];
  const zip = new Zip();

  const done = new Promise<void>((resolve, reject) => {
    zip.ondata = (err, chunk, final) => {
      if (err) return reject(err);
      parts.push(chunk);
      if (final) resolve();
    };
  });

  let processed = 0;
  for (let i = 0; i < files.length; i++) {
    const entry = new ZipPassThrough(names[i]!);
    zip.add(entry);
    const reader = files[i]!.stream().getReader();
    for (;;) {
      const { value, done: eof } = await reader.read();
      if (eof) break;
      entry.push(value, false);
      processed += value.length;
      onProgress?.(processed / total);
    }
    entry.push(new Uint8Array(0), true);
  }
  zip.end();
  await done;

  return new File(parts as unknown as ConstructorParameters<typeof File>[0], `blare-${files.length}-files.zip`, { type: 'application/zip' });
}
