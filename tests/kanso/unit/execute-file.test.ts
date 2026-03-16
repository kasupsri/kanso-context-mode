import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { executeFileTool } from '../../../src/tools/execute-file.js';
import { cleanupTempStateDir, useTempStateDir } from '../test-helpers.js';

let stateDir: string | undefined;

afterEach(() => cleanupTempStateDir(stateDir));

describe('execute_file', () => {
  it('provides fileText aliases and allows top-level return statements', async () => {
    stateDir = useTempStateDir('kcm-execute-file-');
    const fileDir = mkdtempSync(join(tmpdir(), 'kcm-execute-file-src-'));
    const filePath = join(fileDir, 'sample.md');
    writeFileSync(filePath, 'alpha\nbeta\n', 'utf8');

    const result = await executeFileTool({
      file_path: filePath,
      code: 'const lines = fileText.split(/\\r?\\n/); console.log(lines[0]); return lines.length;',
      response_mode: 'full',
    });

    const text = typeof result === 'string' ? result : result.text;
    expect(text).toContain('alpha');
    expect(text).not.toContain('Illegal return statement');
  });
});
