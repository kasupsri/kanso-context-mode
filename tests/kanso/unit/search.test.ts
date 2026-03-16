import { afterEach, describe, expect, it } from 'vitest';
import { indexContentTool } from '../../../src/tools/index-content.js';
import { searchTool } from '../../../src/tools/search.js';
import { cleanupTempStateDir, useTempStateDir } from '../test-helpers.js';

let stateDir: string | undefined;

afterEach(() => cleanupTempStateDir(stateDir));

describe('search', () => {
  it('finds small knowledge-base chunks even when the query includes punctuation-heavy terms', async () => {
    stateDir = useTempStateDir('kcm-search-');

    await indexContentTool({
      kb_name: 'stress-local',
      source: 'bench.md',
      content: [
        '# Kanso Compression Benchmarks',
        '',
        'Large JSON saved 99% with the ultra strategy.',
        '',
        'The balanced overflow-96 token window benchmark hit 34436 ops/sec.',
      ].join('\n'),
      response_mode: 'full',
    });

    const result = await searchTool({
      kb_name: 'stress-local',
      query: 'Large JSON 99% overflow-96 token window',
      response_mode: 'full',
    });

    expect(result.text).toContain('Kanso Compression Benchmarks');
  });
});
