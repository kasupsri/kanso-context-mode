import { execFileSync } from 'child_process';
import { chmodSync, mkdirSync, writeFileSync } from 'fs';
import { createServer } from 'http';
import { dirname, join } from 'path';
import { DEFAULT_CONFIG } from '../src/config/defaults.js';
import { getAppState } from '../src/state/index.js';

export type BenchmarkCategory =
  | 'Compression & Execution'
  | 'Retrieval & Navigation'
  | 'Knowledge & Web'
  | 'Operational';

export interface BenchmarkContext {
  workspaceDir: string;
  callTool: (name: string, args?: Record<string, unknown>) => Promise<string>;
  writeWorkspaceFile: (relativePath: string, content: string) => string;
  withLocalHttpServer: (
    contentType: string,
    body: string,
    run: (url: string) => Promise<void>
  ) => Promise<void>;
  withAstGrepStub: (run: () => Promise<void>) => Promise<void>;
}

export interface BenchmarkScenario {
  tool: string;
  category: BenchmarkCategory;
  description: string;
  measurement: 'tracked' | 'n/a';
  run: (ctx: BenchmarkContext) => Promise<void>;
}

function writeFileRecursive(baseDir: string, relativePath: string, content: string): string {
  const target = join(baseDir, relativePath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content, 'utf8');
  return target;
}

function withTemporaryValue<T>(assign: () => void, restore: () => void, run: () => Promise<T>) {
  assign();
  return run().finally(restore);
}

async function withLocalHttpServer(
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
    throw new Error('Failed to resolve benchmark HTTP server address.');
  }

  const url = `http://127.0.0.1:${address.port}`;
  try {
    await run(url);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}

async function withAstGrepStub(workspaceDir: string, run: () => Promise<void>): Promise<void> {
  const binDir = join(workspaceDir, '.kcm-bin');
  mkdirSync(binDir, { recursive: true });
  const scriptPath = join(binDir, 'sg.js');
  writeFileSync(
    scriptPath,
    [
      "const args = process.argv.slice(2);",
      "if (args.includes('--version')) {",
      "  console.log('sg 0.0.0-benchmark');",
      "  process.exit(0);",
      '}',
      "if (args.includes('--json')) {",
      "  console.log(JSON.stringify([{ file: 'src/example.ts', range: { start: { line: 1 }, end: { line: 3 } }, lines: 'console.log(tokenBudget);' }]));",
      "  process.exit(0);",
      '}',
      "console.log('src/example.ts:2');",
      "console.log('- old()');",
      "console.log('+ new()');",
    ].join('\n'),
    'utf8'
  );
  writeFileSync(join(binDir, 'sg.cmd'), `@echo off\r\nnode "%~dp0\\sg.js" %*\r\n`, 'utf8');
  writeFileSync(
    join(binDir, 'sg'),
    '#!/usr/bin/env bash\nnode "$(dirname "$0")/sg.js" "$@"\n',
    'utf8'
  );
  chmodSync(join(binDir, 'sg'), 0o755);

  const originalPath = process.env['PATH'] ?? '';
  await withTemporaryValue(
    () => {
      process.env['PATH'] = `${binDir}${process.platform === 'win32' ? ';' : ':'}${originalPath}`;
    },
    () => {
      process.env['PATH'] = originalPath;
    },
    run
  );
}

function initGitRepo(repoPath: string): void {
  execFileSync('git', ['init'], { cwd: repoPath, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'bench@example.com'], {
    cwd: repoPath,
    stdio: 'ignore',
  });
  execFileSync('git', ['config', 'user.name', 'Kanso Bench'], {
    cwd: repoPath,
    stdio: 'ignore',
  });
}

export function createBenchmarkContext(
  workspaceDir: string,
  callTool: BenchmarkContext['callTool']
): BenchmarkContext {
  return {
    workspaceDir,
    callTool,
    writeWorkspaceFile: (relativePath, content) => writeFileRecursive(workspaceDir, relativePath, content),
    withLocalHttpServer,
    withAstGrepStub: run => withAstGrepStub(workspaceDir, run),
  };
}

export const BENCHMARK_SCENARIOS: BenchmarkScenario[] = [
  {
    tool: 'compress',
    category: 'Compression & Execution',
    description: 'Large JSON payload compressed to a compact summary.',
    measurement: 'tracked',
    async run(ctx) {
      await ctx.callTool('compress', {
        content: JSON.stringify(
          Array.from({ length: 400 }, (_, index) => ({
            id: index,
            service: 'billing',
            status: index % 11 === 0 ? 'error' : 'ok',
            flags: ['alpha', 'beta', 'gamma'],
          }))
        ),
        response_mode: 'full',
      });
    },
  },
  {
    tool: 'diagnostics_focus',
    category: 'Compression & Execution',
    description: 'Compiler and test failures deduplicated into actionable issues.',
    measurement: 'tracked',
    async run(ctx) {
      await ctx.callTool('diagnostics_focus', {
        content: Array.from(
          { length: 50 },
          () =>
            "src/billing.ts(14,7): error TS2322: Type 'string' is not assignable to type 'number'."
        )
          .concat([
            'FAIL tests/billing.test.ts',
            '  × calculates totals',
            '  ● billing › calculates totals',
          ])
          .join('\n'),
        response_mode: 'full',
      });
    },
  },
  {
    tool: 'execute',
    category: 'Compression & Execution',
    description: 'JavaScript execution with verbose JSON output recorded through the server pipeline.',
    measurement: 'tracked',
    async run(ctx) {
      await ctx.callTool('execute', {
        language: 'javascript',
        code: 'console.log(JSON.stringify(Array.from({ length: 80 }, (_, i) => ({ i, value: `item-${i}`, bucket: i % 4 }))))',
        response_mode: 'full',
      });
    },
  },
  {
    tool: 'execute_file',
    category: 'Compression & Execution',
    description: 'Sandboxed file processing without loading the whole file into model context.',
    measurement: 'tracked',
    async run(ctx) {
      const filePath = ctx.writeWorkspaceFile(
        'docs/report.md',
        Array.from({ length: 120 }, (_, index) => `Section ${index}: token savings details.`).join('\n')
      );
      await ctx.callTool('execute_file', {
        file_path: filePath,
        code: 'const lines = fileText.split(/\\r?\\n/); console.log(JSON.stringify({ lines: lines.length, first: lines[0], last: lines.at(-1) }));',
        response_mode: 'full',
      });
    },
  },
  {
    tool: 'read_file',
    category: 'Retrieval & Navigation',
    description: 'Query-windowed file reads versus full source files.',
    measurement: 'tracked',
    async run(ctx) {
      const filePath = ctx.writeWorkspaceFile(
        'src/billing.ts',
        [
          'export const tokenBudget = 400;',
          'export function calculateInvoice() {',
          '  return tokenBudget * 2;',
          '}',
          '',
          ...Array.from({ length: 80 }, (_, index) => `export const filler${index} = ${index};`),
        ].join('\n')
      );
      await ctx.callTool('read_file', {
        path: filePath,
        query: 'calculateInvoice',
        response_mode: 'full',
      });
    },
  },
  {
    tool: 'read_symbols',
    category: 'Retrieval & Navigation',
    description: 'Structure-first symbol inventory from a large source file.',
    measurement: 'tracked',
    async run(ctx) {
      const filePath = ctx.writeWorkspaceFile(
        'src/symbols.ts',
        [
          'export function alpha() { return 1; }',
          'export function beta() { return 2; }',
          'export class InvoiceService {}',
          ...Array.from({ length: 60 }, (_, index) => `export const value${index} = ${index};`),
        ].join('\n')
      );
      await ctx.callTool('read_symbols', {
        path: filePath,
        response_mode: 'full',
      });
    },
  },
  {
    tool: 'read_references',
    category: 'Retrieval & Navigation',
    description: 'Reference lookup from a stored context handle instead of replaying full file text.',
    measurement: 'tracked',
    async run(ctx) {
      const sourcePath = ctx.writeWorkspaceFile(
        'src/references.ts',
        [
          'export const tokenBudget = 400;',
          'export function useBudget() {',
          '  return tokenBudget;',
          '}',
          'export function duplicateBudget() {',
          '  return tokenBudget * 2;',
          '}',
        ].join('\n')
      );
      const contextId = getAppState().saveHandle(
        [
          'export const tokenBudget = 400;',
          'export function useBudget() {',
          '  return tokenBudget;',
          '}',
          'export function duplicateBudget() {',
          '  return tokenBudget * 2;',
          '}',
        ].join('\n'),
        sourcePath
      ).id;
      await ctx.callTool('read_references', {
        context_id: contextId,
        symbol: 'tokenBudget',
        response_mode: 'full',
      });
    },
  },
  {
    tool: 'workspace_search',
    category: 'Retrieval & Navigation',
    description: 'Repository-wide search with grouped snippets instead of full-file dumps.',
    measurement: 'tracked',
    async run(ctx) {
      ctx.writeWorkspaceFile('src/billing.ts', 'export function updateBillingInvoice() { return "invoice logic"; }\n');
      ctx.writeWorkspaceFile('src/profile.ts', 'export function updateProfile() { return "profile"; }\n');
      await ctx.callTool('workspace_search', {
        root_path: ctx.workspaceDir,
        query: 'invoice logic',
        response_mode: 'full',
      });
    },
  },
  {
    tool: 'tree_focus',
    category: 'Retrieval & Navigation',
    description: 'Bounded tree views for repo exploration.',
    measurement: 'tracked',
    async run(ctx) {
      for (let index = 0; index < 45; index += 1) {
        ctx.writeWorkspaceFile(`src/generated/file-${index}.ts`, `export const value${index} = ${index};\n`);
      }
      ctx.writeWorkspaceFile('src/ui/card.tsx', 'export const Card = () => null;\n');
      ctx.writeWorkspaceFile('src/server/index.ts', 'export const server = true;\n');
      ctx.writeWorkspaceFile('docs/overview.md', '# Overview\n');
      await ctx.callTool('tree_focus', {
        path: ctx.workspaceDir,
        response_mode: 'full',
      });
    },
  },
  {
    tool: 'git_focus',
    category: 'Retrieval & Navigation',
    description: 'Diff summarization instead of raw hunks.',
    measurement: 'tracked',
    async run(ctx) {
      const repoPath = join(ctx.workspaceDir, 'repo');
      mkdirSync(repoPath, { recursive: true });
      initGitRepo(repoPath);
      writeFileSync(
        join(repoPath, 'billing.ts'),
        [
          'export function calculateInvoice() {',
          '  return 41;',
          '}',
          ...Array.from({ length: 80 }, (_, index) => `export const value${index} = ${index};`),
        ].join('\n'),
        'utf8'
      );
      execFileSync('git', ['add', 'billing.ts'], { cwd: repoPath, stdio: 'ignore' });
      await ctx.callTool('git_focus', {
        repo_path: repoPath,
        scope: 'staged',
        response_mode: 'full',
      });
    },
  },
  {
    tool: 'structure_search',
    category: 'Retrieval & Navigation',
    description: 'Syntax-aware search summarized from ast-grep JSON.',
    measurement: 'tracked',
    async run(ctx) {
      ctx.writeWorkspaceFile('src/example.ts', 'const tokenBudget = 400;\nconsole.log(tokenBudget);\n');
      await ctx.withAstGrepStub(async () => {
        await ctx.callTool('structure_search', {
          path: ctx.workspaceDir,
          pattern: 'console.log($A)',
          language: 'typescript',
          response_mode: 'full',
        });
      });
    },
  },
  {
    tool: 'rewrite_preview',
    category: 'Retrieval & Navigation',
    description: 'Structural rewrite previews from controlled ast-grep output.',
    measurement: 'tracked',
    async run(ctx) {
      ctx.writeWorkspaceFile('src/example.ts', 'old();\n');
      await ctx.withAstGrepStub(async () => {
        await ctx.callTool('rewrite_preview', {
          path: ctx.workspaceDir,
          pattern: 'old()',
          rewrite: 'new()',
          language: 'typescript',
          response_mode: 'full',
        });
      });
    },
  },
  {
    tool: 'terminal_history',
    category: 'Retrieval & Navigation',
    description: 'Terminal run summaries instead of replayed command output.',
    measurement: 'tracked',
    async run(ctx) {
      const output = Array.from({ length: 60 }, (_, index) => `line ${index}: test output`).join('\n');
      const handle = getAppState().saveHandle(output, 'run-output');
      getAppState().recordTerminalRun({
        command: 'npm test',
        cwd: ctx.workspaceDir,
        language: 'shell',
        runtime: 'bash',
        exitCode: 0,
        timedOut: false,
        durationMs: 420,
        outputHandleId: handle.id,
        outputText: output,
      });
      await ctx.callTool('terminal_history', {
        response_mode: 'full',
      });
    },
  },
  {
    tool: 'run_focus',
    category: 'Retrieval & Navigation',
    description: 'Focused inspection of a prior terminal run from stored output.',
    measurement: 'tracked',
    async run(ctx) {
      const output = Array.from({ length: 80 }, (_, index) => `log ${index}: status ok`).join('\n');
      const handle = getAppState().saveHandle(output, 'run-focus-output');
      const run = getAppState().recordTerminalRun({
        command: 'npm run build',
        cwd: ctx.workspaceDir,
        language: 'shell',
        runtime: 'bash',
        exitCode: 0,
        timedOut: false,
        durationMs: 512,
        outputHandleId: handle.id,
        outputText: output,
      });
      await ctx.callTool('run_focus', {
        run_id: run.id,
        response_mode: 'full',
      });
    },
  },
  {
    tool: 'session_resume',
    category: 'Retrieval & Navigation',
    description: 'Session continuity snapshots built from stored session events.',
    measurement: 'tracked',
    async run(ctx) {
      getAppState().recordSessionEvents(
        'codex',
        [
          { type: 'task', category: 'task', priority: 1, data: 'debug billing retries' },
          { type: 'file', category: 'file', priority: 1, data: 'src/billing.ts' },
          { type: 'decision', category: 'decision', priority: 1, data: 'keep retries capped at 3' },
          { type: 'error', category: 'error', priority: 2, data: 'timeout in invoice sync' },
        ],
        'bench-session'
      );
      await ctx.callTool('session_resume', {
        host: 'codex',
        session_id: 'bench-session',
        response_mode: 'full',
      });
    },
  },
  {
    tool: 'edit_targets',
    category: 'Retrieval & Navigation',
    description: 'Likely edit file ranking instead of broad repo reads.',
    measurement: 'tracked',
    async run(ctx) {
      ctx.writeWorkspaceFile('src/billing.ts', 'export function updateBillingInvoice() { return 42; }\n');
      ctx.writeWorkspaceFile('src/profile.ts', 'export function updateProfile() { return true; }\n');
      await ctx.callTool('edit_targets', {
        task: 'update billing invoice logic',
        paths: [ctx.workspaceDir],
        response_mode: 'full',
      });
    },
  },
  {
    tool: 'index',
    category: 'Knowledge & Web',
    description: 'Indexing documentation into the local knowledge base with compact confirmation output.',
    measurement: 'tracked',
    async run(ctx) {
      await ctx.callTool('index', {
        kb_name: 'bench-index',
        source: 'inline-docs',
        content: '# Billing\n\nUse token budgets for focused retrieval.\n\n```ts\nexport const tokenBudget = 400;\n```',
        response_mode: 'full',
      });
    },
  },
  {
    tool: 'search',
    category: 'Knowledge & Web',
    description: 'Knowledge-base retrieval against the full indexed corpus size.',
    measurement: 'tracked',
    async run(ctx) {
      getAppState().indexKnowledgeText(
        [
          '# Billing',
          'Token budgets keep prompts compact.',
          'Use focused retrieval instead of replaying the entire corpus.',
          '```ts',
          'export const tokenBudget = 400;',
          '```',
        ].join('\n'),
        { source: 'inline-search', kbName: 'bench-search' }
      );
      await ctx.callTool('search', {
        query: 'token budget',
        kb_name: 'bench-search',
        response_mode: 'full',
      });
    },
  },
  {
    tool: 'fetch_and_index',
    category: 'Knowledge & Web',
    description: 'Fetched docs converted and indexed locally under controlled HTTP input.',
    measurement: 'tracked',
    async run(ctx) {
      const originalAllowPrivateNetworkFetch = DEFAULT_CONFIG.security.allowPrivateNetworkFetch;
      await withTemporaryValue(
        () => {
          DEFAULT_CONFIG.security.allowPrivateNetworkFetch = true;
        },
        () => {
          DEFAULT_CONFIG.security.allowPrivateNetworkFetch = originalAllowPrivateNetworkFetch;
        },
        async () => {
          await ctx.withLocalHttpServer(
            'text/html; charset=utf-8',
            '<h1>Kanso</h1><p>Token efficient coding workflows.</p>',
            async url => {
              await ctx.callTool('fetch_and_index', {
                url,
                kb_name: 'bench-fetch',
                response_mode: 'full',
              });
            }
          );
        }
      );
    },
  },
  {
    tool: 'web_search',
    category: 'Knowledge & Web',
    description: 'Provider-backed web search through a deterministic mocked response.',
    measurement: 'tracked',
    async run(ctx) {
      const originalProvider = DEFAULT_CONFIG.web.provider;
      const originalBraveKey = DEFAULT_CONFIG.web.braveApiKey;
      const originalFetch = globalThis.fetch;
      await withTemporaryValue(
        () => {
          DEFAULT_CONFIG.web.provider = 'brave_context';
          DEFAULT_CONFIG.web.braveApiKey = 'benchmark-key';
          globalThis.fetch = (async () =>
            ({
              ok: true,
              status: 200,
              statusText: 'OK',
              json: async () => ({
                results: [
                  {
                    url: 'https://example.com/docs',
                    title: 'Token Efficient Docs',
                    description: 'Guidance for token efficient coding workflows.',
                    text: 'Longer grounding text about token efficient coding workflows and context savings.',
                  },
                ],
              }),
            }) as Response) as typeof fetch;
        },
        () => {
          DEFAULT_CONFIG.web.provider = originalProvider;
          DEFAULT_CONFIG.web.braveApiKey = originalBraveKey;
          globalThis.fetch = originalFetch;
        },
        async () => {
          await ctx.callTool('web_search', {
            query: 'token efficient docs',
            response_mode: 'full',
          });
        }
      );
    },
  },
  {
    tool: 'doctor',
    category: 'Operational',
    description: 'Operational diagnostics; not expected to create token savings metrics.',
    measurement: 'n/a',
    async run(ctx) {
      await ctx.callTool('doctor', { response_mode: 'full' });
    },
  },
  {
    tool: 'stats_report',
    category: 'Operational',
    description: 'Operational reporting surface; not tracked as a savings event.',
    measurement: 'n/a',
    async run(ctx) {
      await ctx.callTool('stats_report', { response_mode: 'full' });
    },
  },
  {
    tool: 'stats_export',
    category: 'Operational',
    description: 'Exports the current stats JSON without contributing its own tracked event.',
    measurement: 'n/a',
    async run(ctx) {
      await ctx.callTool('stats_export', {
        path: join(ctx.workspaceDir, 'stats-export.json'),
        response_mode: 'full',
      });
    },
  },
  {
    tool: 'stats_reset',
    category: 'Operational',
    description: 'Resets the session window; operational only.',
    measurement: 'n/a',
    async run(ctx) {
      await ctx.callTool('stats_reset', { response_mode: 'full' });
    },
  },
];
