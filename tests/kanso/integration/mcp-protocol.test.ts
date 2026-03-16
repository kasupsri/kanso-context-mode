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
const extractResourceLinks = (result: {
  content?: unknown;
}): Array<{ uri: string; name?: string }> =>
  ((result.content as Array<{ type: string; uri: string; name?: string }>) ?? []).filter(
    item => item.type === 'resource_link'
  );

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

  it('lists the expanded Kanso tool surface', async () => {
    const { tools } = await client.listTools();
    const names = tools.map(tool => tool.name).sort();

    expect(names).toEqual([
      'compress',
      'diagnostics_focus',
      'doctor',
      'edit_targets',
      'execute',
      'execute_file',
      'fetch_and_index',
      'git_focus',
      'index',
      'read_file',
      'read_references',
      'read_symbols',
      'rewrite_preview',
      'run_focus',
      'search',
      'session_resume',
      'stats_export',
      'stats_report',
      'stats_reset',
      'structure_search',
      'terminal_history',
      'tree_focus',
      'web_search',
      'workspace_search',
    ]);
  });

  it('exposes resources and prompts for the new MCP surface', async () => {
    const resources = await client.listResources();
    expect(resources.resources.some(resource => resource.uri.startsWith('session://'))).toBe(true);

    const prompts = await client.listPrompts();
    const promptNames = prompts.prompts.map(prompt => prompt.name).sort();
    expect(promptNames).toEqual([
      'draft_commit_message',
      'research_topic',
      'review_diff',
      'summarize_run',
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
    const resourceUri = extractResourceLinks(first).find(link =>
      link.uri.startsWith('context://')
    )?.uri;
    const contextId = resourceUri?.replace('context://', '');

    expect(contextId).toBeTruthy();

    const second = await client.callTool({
      name: 'read_references',
      arguments: { context_id: contextId, symbol: 'tokenBudget', response_mode: 'full' },
    });

    expect(extractText(second)).toContain('tokenBudget');
  });

  it('preserves compact tool text instead of replacing it with candidate text', async () => {
    const index = await client.callTool({
      name: 'index',
      arguments: {
        kb_name: 'protocol-test',
        source: 'inline',
        content:
          '# Kanso Compression Benchmarks\n\nLarge JSON saved 99%.\n\nbalanced overflow-96 token window benchmark.\n',
        response_mode: 'minimal',
      },
    });
    expect(extractText(index)).toContain('ok:index');

    const search = await client.callTool({
      name: 'search',
      arguments: {
        kb_name: 'protocol-test',
        query: 'Large JSON 99% overflow-96 token window',
        response_mode: 'minimal',
      },
    });
    expect(extractText(search)).toMatch(/^search /);

    const sessionResume = await client.callTool({
      name: 'session_resume',
      arguments: {
        host: 'codex',
        response_mode: 'minimal',
      },
    });
    expect(extractText(sessionResume)).toMatch(/^ok:session_resume /);
    expect(extractText(sessionResume)).toContain('host=codex');
  });
});
