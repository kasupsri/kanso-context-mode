import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { readFileTool } from '../../../src/tools/read-file.js';
import { readReferencesTool } from '../../../src/tools/read-references.js';
import { cleanupTempStateDir, useTempStateDir } from '../test-helpers.js';

let stateDir: string | undefined;

afterEach(() => cleanupTempStateDir(stateDir));

describe('disk-backed file handles', () => {
  it('persists context_id handles across app-state resets', async () => {
    stateDir = useTempStateDir();
    const fileDir = mkdtempSync(join(tmpdir(), 'kcm-file-'));
    const filePath = join(fileDir, 'sample.ts');
    writeFileSync(
      filePath,
      [
        'export function alpha() {',
        '  return 1;',
        '}',
        '',
        'export function beta() {',
        '  return 2;',
        '}',
      ].join('\n'),
      'utf8'
    );

    const first = await readFileTool({ path: filePath, query: 'beta', response_mode: 'full' });
    const match = /context_id: (\S+)/.exec(first);
    expect(match?.[1]).toBeTruthy();

    const second = await readReferencesTool({
      context_id: match?.[1],
      symbol: 'beta',
      response_mode: 'full',
    });

    expect(second).toContain('beta');
    expect(second).toContain('context_id:');
  });
});
