import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer } from 'http';
import { DEFAULT_CONFIG } from '../../../src/config/defaults.js';
import { fetchAndIndexTool } from '../../../src/tools/fetch-and-index.js';
import { searchTool } from '../../../src/tools/search.js';
import { cleanupTempStateDir, useTempStateDir } from '../test-helpers.js';

let stateDir: string | undefined;

const originalAllowPrivateNetworkFetch = DEFAULT_CONFIG.security.allowPrivateNetworkFetch;
const originalMaxFetchBytes = DEFAULT_CONFIG.knowledgeBase.maxFetchBytes;

beforeEach(() => {
  stateDir = useTempStateDir('kcm-fetch-');
});

afterEach(() => {
  DEFAULT_CONFIG.security.allowPrivateNetworkFetch = originalAllowPrivateNetworkFetch;
  DEFAULT_CONFIG.knowledgeBase.maxFetchBytes = originalMaxFetchBytes;
  cleanupTempStateDir(stateDir);
  stateDir = undefined;
});

async function withHttpServer(
  contentType: string,
  body: string,
  run: (url: string) => Promise<void>
): Promise<void> {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(body);
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(0, '127.0.0.1', err => {
      if (err) reject(err);
      else resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    await new Promise<void>(resolve => server.close(() => resolve()));
    throw new Error('Failed to resolve test server address.');
  }

  const url = `http://127.0.0.1:${address.port}`;

  try {
    await run(url);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}

describe('fetch_and_index', () => {
  it('indexes HTML content when fetching is allowed', async () => {
    DEFAULT_CONFIG.security.allowPrivateNetworkFetch = true;
    DEFAULT_CONFIG.knowledgeBase.maxFetchBytes = 4096;

    await withHttpServer(
      'text/html; charset=utf-8',
      '<h1>Kanso</h1><p>Token efficient coding workflows.</p>',
      async url => {
        const result = await fetchAndIndexTool({ url, kb_name: 'docs', response_mode: 'full' });
        expect(result.text).toContain('Fetched and indexed');

        const search = await searchTool({
          query: 'efficient',
          kb_name: 'docs',
          response_mode: 'full',
        });
        expect(search.text).toContain('Token efficient coding workflows.');
      }
    );
  });

  it('blocks private-network fetches by default', async () => {
    DEFAULT_CONFIG.security.allowPrivateNetworkFetch = false;

    const result = await fetchAndIndexTool({
      url: 'http://127.0.0.1:44444',
      response_mode: 'full',
    });

    expect(result.text).toContain('Refusing to fetch private IP address');
  });

  it('rejects oversized fetch responses', async () => {
    DEFAULT_CONFIG.security.allowPrivateNetworkFetch = true;
    DEFAULT_CONFIG.knowledgeBase.maxFetchBytes = 32;

    await withHttpServer('text/plain; charset=utf-8', 'x'.repeat(128), async url => {
      const result = await fetchAndIndexTool({ url, response_mode: 'full' });
      expect(result.text).toContain('exceeds size limit');
    });
  });
});
