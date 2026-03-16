import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createServer } from '../../../src/server.js';
import { cleanupTempStateDir, useTempStateDir } from '../test-helpers.js';

const extractText = (result: { content?: unknown }): string =>
  ((result.content as Array<{ type: string; text: string }>)[0]?.text ?? '') as string;

describe('MCP protocol', () => {
  let client: Client;
  let cleanupDir: string | undefined;

  beforeAll(async () => {
    cleanupDir = useTempStateDir();
    const { server } = createServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client(
      { name: 'kcm-test-client', version: '1.0.0' },
      { capabilities: { tools: {} } }
    );
    await server.connect(serverTransport);
    await client.connect(clientTransport);
  });

  afterAll(async () => {
    await client.close();
    cleanupTempStateDir(cleanupDir);
  });

  it('lists the Kanso v1 tool surface', async () => {
    const { tools } = await client.listTools();
    const names = tools.map(tool => tool.name).sort();

    expect(names).toEqual([
      'compress',
      'diagnostics_focus',
      'doctor',
      'execute',
      'execute_file',
      'fetch_and_index',
      'git_focus',
      'index',
      'read_file',
      'read_references',
      'read_symbols',
      'search',
      'session_resume',
      'stats_export',
      'stats_report',
      'stats_reset',
    ]);
  });

  it('executes code and tracks savings', async () => {
    const result = await client.callTool({
      name: 'execute',
      arguments: {
        language: 'javascript',
        code: 'console.log(JSON.stringify(Array.from({length: 50}, (_, i) => ({ i, value: `item-${i}` }))))',
      },
    });

    expect(result.isError).toBeFalsy();
    expect(extractText(result)).toMatch(/json:a n=50|item-0/);

    const stats = await client.callTool({
      name: 'stats_report',
      arguments: { response_mode: 'full' },
    });
    expect(extractText(stats)).toContain('SESSION');
  });

  it('supports disk-backed read_file context handles through MCP', async () => {
    const filePath = join(tmpdir(), `kcm-mcp-${Date.now()}.ts`);
    writeFileSync(
      filePath,
      [
        'export const tokenBudget = 400;',
        'export function fastPath() {',
        '  return tokenBudget;',
        '}',
      ].join('\n')
    );

    const first = await client.callTool({
      name: 'read_file',
      arguments: { path: filePath, query: 'fastPath', response_mode: 'full' },
    });
    const text = extractText(first);
    const contextId = /context_id: (\S+)/.exec(text)?.[1];

    expect(contextId).toBeTruthy();

    const second = await client.callTool({
      name: 'read_references',
      arguments: { context_id: contextId, symbol: 'tokenBudget', response_mode: 'full' },
    });

    expect(extractText(second)).toContain('tokenBudget');
  });
});
