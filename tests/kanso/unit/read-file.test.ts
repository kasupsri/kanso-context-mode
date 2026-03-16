import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { readFileTool } from '../../../src/tools/read-file.js';
import { readReferencesTool } from '../../../src/tools/read-references.js';
import { cleanupTempStateDir, useTempStateDir } from '../test-helpers.js';

let stateDir: string | undefined;

afterEach(() => cleanupTempStateDir(stateDir));

function extractContextId(
  result: string | { resourceLinks?: Array<{ uri: string }>; text: string }
): string | undefined {
  if (typeof result === 'string') {
    return /context_id: (\S+)/.exec(result)?.[1];
  }

  const direct = /context_id: (\S+)/.exec(result.text)?.[1];
  if (direct) return direct;
  const resourceUri = result.resourceLinks?.find(link => link.uri.startsWith('context://'))?.uri;
  return resourceUri?.replace('context://', '');
}

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
    const contextId = extractContextId(first);
    expect(contextId).toBeTruthy();

    const second = await readReferencesTool({
      context_id: contextId,
      symbol: 'beta',
      response_mode: 'full',
    });

    const text = typeof second === 'string' ? second : second.text;
    expect(text).toContain('beta');
    expect(text).toContain('context_id:');
  });
});
