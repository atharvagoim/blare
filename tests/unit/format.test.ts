import { describe, expect, it } from 'vitest';
import { formatBytes, formatCountdown } from '../../src/lib/format.js';

describe('formatCountdown', () => {
  it('formats minutes and hours', () => {
    expect(formatCountdown(300)).toBe('5:00');
    expect(formatCountdown(299.2)).toBe('5:00');
    expect(formatCountdown(59)).toBe('0:59');
    expect(formatCountdown(3600)).toBe('1:00:00');
    expect(formatCountdown(86399)).toBe('23:59:59');
    expect(formatCountdown(-4)).toBe('0:00');
  });
});

describe('formatBytes', () => {
  it('uses sensible units', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(100 * 1024 * 1024)).toBe('100 MB');
  });
});
