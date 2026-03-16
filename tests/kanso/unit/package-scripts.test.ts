import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

interface PackageJson {
  scripts?: Record<string, string>;
}

describe('package scripts', () => {
  it('exposes a single terminal stats command for savings reporting', () => {
    const pkg = JSON.parse(
      readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')
    ) as PackageJson;

    expect(pkg.scripts?.stats).toBe('node dist/index.js stats');
    expect(pkg.scripts?.report).toBeUndefined();
    expect(pkg.scripts?.stats_report).toBeUndefined();
    expect(pkg.scripts?.status_report).toBeUndefined();
  });
});
