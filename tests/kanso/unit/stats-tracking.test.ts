import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { execFileSync } from 'child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from '../../../src/server.js';
import { getAppState } from '../../../src/state/index.js';
import { cleanupTempStateDir, useTempStateDir } from '../test-helpers.js';

type ToolCallResult = {
  content?: unknown;
  isError?: boolean;
};

const extractText = (result: ToolCallResult): string =>
  ((result.content as Array<{ type: string; text: string }>)[0]?.text ?? '') as string;

async function withClient(run: (client: Client) => Promise<void>): Promise<void> {
  const { server } = createServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client(
    { name: 'kcm-stats-client', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  try {
    await run(client);
  } finally {
    await client.close();
    await server.close();
  }
}

describe('stats tracking coverage', () => {
  let stateDir: string | undefined;

  afterEach(() => cleanupTempStateDir(stateDir));

  it('tracks savings for compress and diagnostics_focus', async () => {
    stateDir = useTempStateDir('kcm-track-core-');

    await withClient(async client => {
      await client.callTool({
        name: 'compress',
        arguments: {
          content: JSON.stringify(
            Array.from({ length: 200 }, (_, index) => ({ index, flag: true }))
          ),
          response_mode: 'full',
        },
      });
      await client.callTool({
        name: 'diagnostics_focus',
        arguments: {
          content: Array.from(
            { length: 40 },
            () =>
              "src/demo.ts(3,7): error TS2322: Type 'string' is not assignable to type 'number'."
          )
            .concat(['FAIL tests/demo.test.ts', '  × fails fast'])
            .join('\n'),
          response_mode: 'full',
        },
      });
    });

    const snapshot = getAppState().getStatsSnapshot();
    expect(
      snapshot.session.byTool.find(tool => tool.tool === 'compress')?.totalSavedTokens
    ).toBeGreaterThan(0);
    expect(
      snapshot.session.byTool.find(tool => tool.tool === 'diagnostics_focus')?.totalSavedTokens
    ).toBeGreaterThan(0);
  });

  it('tracks savings for tree_focus, search, session_resume, and edit_targets', async () => {
    stateDir = useTempStateDir('kcm-track-retrieval-');
    const root = mkdtempSync(join(tmpdir(), 'kcm-track-root-'));
    mkdirSync(join(root, 'src'));
    for (let index = 0; index < 40; index += 1) {
      writeFileSync(
        join(root, 'src', `file-${index}.ts`),
        `export const value${index} = ${index};\n`,
        'utf8'
      );
    }
    writeFileSync(
      join(root, 'src', 'billing.ts'),
      'export function updateBillingInvoice() { return 42; }\n',
      'utf8'
    );
    writeFileSync(
      join(root, 'src', 'profile.ts'),
      'export function updateProfile() { return true; }\n',
      'utf8'
    );
    getAppState().indexKnowledgeText(
      '# Billing\nToken budgets keep prompts compact.\n```ts\nexport const tokenBudget = 400;\n```',
      { source: 'inline', kbName: 'tracking-search' }
    );
    getAppState().recordSessionEvents(
      'codex',
      [
        { type: 'task', category: 'task', priority: 1, data: 'debug billing retries' },
        { type: 'decision', category: 'decision', priority: 1, data: 'keep retries capped at 3' },
      ],
      'tracking-session'
    );

    await withClient(async client => {
      await client.callTool({
        name: 'tree_focus',
        arguments: { path: root, response_mode: 'full' },
      });
      await client.callTool({
        name: 'search',
        arguments: { kb_name: 'tracking-search', query: 'token budget', response_mode: 'full' },
      });
      await client.callTool({
        name: 'session_resume',
        arguments: { host: 'codex', session_id: 'tracking-session', response_mode: 'full' },
      });
      await client.callTool({
        name: 'edit_targets',
        arguments: { task: 'update billing invoice logic', paths: [root], response_mode: 'full' },
      });
    });

    const snapshot = getAppState().getStatsSnapshot();
    expect(
      snapshot.session.byTool.find(tool => tool.tool === 'tree_focus')?.totalSavedTokens
    ).toBeGreaterThan(0);
    expect(
      snapshot.session.byTool.find(tool => tool.tool === 'search')?.retrievalSavedTokens
    ).toBeGreaterThan(0);
    expect(
      snapshot.session.byTool.find(tool => tool.tool === 'session_resume')?.compressionSavedTokens
    ).toBeGreaterThanOrEqual(0);
    expect(
      snapshot.session.byTool.find(tool => tool.tool === 'edit_targets')?.totalSavedTokens
    ).toBeGreaterThan(0);
  });

  it('tracks savings for git_focus against a real git diff baseline', async () => {
    stateDir = useTempStateDir('kcm-track-git-');
    const repo = mkdtempSync(join(tmpdir(), 'kcm-track-git-repo-'));
    writeFileSync(
      join(repo, 'billing.ts'),
      [
        'export function calculateInvoice() {',
        '  return 41;',
        '}',
        ...Array.from({ length: 80 }, (_, index) => `export const value${index} = ${index};`),
      ].join('\n'),
      'utf8'
    );

    await withClient(async client => {
      execFileSync('git', ['init'], { cwd: repo, stdio: 'ignore' });
      execFileSync('git', ['config', 'user.email', 'stats@test.dev'], {
        cwd: repo,
        stdio: 'ignore',
      });
      execFileSync('git', ['config', 'user.name', 'Stats Test'], { cwd: repo, stdio: 'ignore' });
      execFileSync('git', ['add', 'billing.ts'], { cwd: repo, stdio: 'ignore' });

      const result = await client.callTool({
        name: 'git_focus',
        arguments: { repo_path: repo, scope: 'staged', response_mode: 'full' },
      });
      expect(extractText(result)).toContain('Git Focus');
    });

    const snapshot = getAppState().getStatsSnapshot();
    const gitFocus = snapshot.session.byTool.find(tool => tool.tool === 'git_focus');
    expect(gitFocus?.sourceTokens).toBeGreaterThan(0);
    expect(gitFocus?.totalSavedTokens).toBeGreaterThan(0);
  });
});
