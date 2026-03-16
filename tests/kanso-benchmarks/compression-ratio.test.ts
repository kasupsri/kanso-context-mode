import { describe, expect, it } from 'vitest';
import { compress } from '../../src/compression/strategies.js';

function kb(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)}KB`;
}

describe('compression ratio smoke benchmarks', () => {
  it('compresses large JSON aggressively', () => {
    const input = JSON.stringify(
      Array.from({ length: 500 }, (_, i) => ({
        id: i,
        name: `item-${i}`,
        flags: ['alpha', 'beta', 'gamma'],
      }))
    );
    const result = compress(input, { maxOutputChars: 3000, strategy: 'ultra' });
    expect(result.output.length).toBeLessThan(input.length / 4);
  });

  it('compresses noisy logs while keeping errors', () => {
    const input =
      Array.from(
        { length: 1000 },
        (_, i) => `2026-03-16T10:00:${String(i % 60).padStart(2, '0')}Z INFO request ${i}`
      ).join('\n') + '\n2026-03-16T10:02:00Z ERROR database timeout';
    const result = compress(input, { maxOutputChars: 2500, strategy: 'ultra' });
    expect(result.output).toMatch(/ERROR|timeout/i);
    expect(result.output.length).toBeLessThan(input.length / 3);
  });

  it('compresses diffs into compact summaries', () => {
    const input = [
      'diff --git a/src/app.ts b/src/app.ts',
      '@@ -1,0 +1,6 @@',
      '+export function main() {',
      '+  console.log("hello");',
      '+}',
      'diff --git a/src/cache.ts b/src/cache.ts',
      '@@ -10,2 +10,5 @@',
      '-const oldCache = true;',
      '+const hotCache = true;',
      '+export const HOT_CACHE_LIMIT = 32;',
    ].join('\n');
    const result = compress(input, { maxOutputChars: 1000, strategy: 'ultra' });
    expect(result.output.length).toBeLessThan(input.length);
  });

  it('reports benchmark context for humans', () => {
    const input = 'a'.repeat(8192);
    const result = compress(input, { maxOutputChars: 1024, strategy: 'ultra' });
    expect(`${kb(input.length)} -> ${kb(result.output.length)}`).toContain('KB');
  });
});
