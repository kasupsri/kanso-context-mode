import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';
import { APP_VERSION } from '../../../src/version.js';

describe('version metadata', () => {
  it('matches package.json', () => {
    const pkg = JSON.parse(
      readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')
    ) as { version: string };

    expect(APP_VERSION).toBe(pkg.version);
  });
});
