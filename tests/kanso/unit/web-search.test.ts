import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from '../../../src/config/defaults.js';
import { webSearchTool } from '../../../src/tools/web-search.js';
import { cleanupTempStateDir, useTempStateDir } from '../test-helpers.js';

let stateDir: string | undefined;
const originalProvider = DEFAULT_CONFIG.web.provider;
const originalBraveKey = DEFAULT_CONFIG.web.braveApiKey;

beforeEach(() => {
  stateDir = useTempStateDir('kcm-web-');
  DEFAULT_CONFIG.web.provider = 'brave_context';
  DEFAULT_CONFIG.web.braveApiKey = 'test-key';
});

afterEach(() => {
  DEFAULT_CONFIG.web.provider = originalProvider;
  DEFAULT_CONFIG.web.braveApiKey = originalBraveKey;
  vi.restoreAllMocks();
  cleanupTempStateDir(stateDir);
  stateDir = undefined;
});

describe('web_search', () => {
  it('normalizes provider results and uses the durable cache on repeated queries', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        results: [
          {
            url: 'https://example.com/docs',
            title: 'Docs',
            description: 'Token efficient docs',
            text: 'Token efficient docs and grounding text.',
          },
        ],
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const first = await webSearchTool({
      query: 'token efficient docs',
      response_mode: 'full',
    });
    const second = await webSearchTool({
      query: 'token efficient docs',
      response_mode: 'full',
    });

    expect(first.text).toContain('Web Search');
    expect(first.resourceLinks?.some(link => link.uri.startsWith('context://'))).toBe(true);
    expect(second.text).toContain('cache: hit');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
