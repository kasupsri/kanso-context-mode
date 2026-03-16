import { describe, expect, it } from 'vitest';
import { join } from 'path';
import { tmpdir } from 'os';
import { indexContentTool } from '../../../src/tools/index-content.js';
import { statsExportTool } from '../../../src/tools/stats-export.js';

describe('tool path security', () => {
  it('blocks denied paths for index', async () => {
    const deniedPath = join(tmpdir(), '.env');

    await expect(indexContentTool({ path: deniedPath })).rejects.toThrow(
      /Blocked by security policy/
    );
  });

  it('blocks denied paths for stats export', () => {
    const deniedPath = join(tmpdir(), '.env');
    const result = statsExportTool({ path: deniedPath });

    expect(result).toContain('Blocked by security policy');
  });
});
