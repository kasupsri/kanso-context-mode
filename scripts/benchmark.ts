#!/usr/bin/env tsx
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { rmSync, writeFileSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createServer, TOOLS } from '../src/server.js';
import { DEFAULT_CONFIG } from '../src/config/defaults.js';
import { getAppState, resetAppStateForTests } from '../src/state/index.js';
import {
  BENCHMARK_SCENARIOS,
  createBenchmarkContext,
  type BenchmarkCategory,
} from './benchmark-scenarios.js';

type BenchmarkRow = {
  tool: string;
  category: BenchmarkCategory;
  description: string;
  measurement: 'tracked' | 'n/a';
  sourceTokens: number | null;
  outputTokens: number | null;
  savedTokens: number | null;
  savedPct: number | null;
  outputPct: number | null;
  ratio: number | null;
};

function extractText(result: { content?: unknown }): string {
  return ((result.content as Array<{ type: string; text: string }>)[0]?.text ?? '') as string;
}

function formatInteger(value: number): string {
  return Math.trunc(value).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function formatTokenValue(value: number | null): string {
  if (value === null) return 'n/a';
  return `${formatInteger(value)} tok`;
}

function formatPct(value: number | null): string {
  if (value === null) return 'n/a';
  return `${value.toFixed(1)}%`;
}

function formatRatio(value: number | null): string {
  if (value === null) return 'n/a';
  return `${value.toFixed(1)}x`;
}

async function runScenario(
  scenario: (typeof BENCHMARK_SCENARIOS)[number]
): Promise<BenchmarkRow> {
  const stateDir = mkdtempSync(join(tmpdir(), 'kcm-bench-state-'));
  const workspaceDir = mkdtempSync(join(tmpdir(), 'kcm-bench-workspace-'));
  const originalCwd = process.cwd();
  const originalStateDir = DEFAULT_CONFIG.storage.stateDir;

  DEFAULT_CONFIG.storage.stateDir = stateDir;
  resetAppStateForTests();
  process.chdir(workspaceDir);

  const { server } = createServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client(
    { name: 'kcm-benchmark-client', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const context = createBenchmarkContext(workspaceDir, async (name, args = {}) => {
      const result = await client.callTool({
        name,
        arguments: args,
      });
      return extractText(result);
    });

    await scenario.run(context);

    if (scenario.measurement === 'n/a') {
      return {
        tool: scenario.tool,
        category: scenario.category,
        description: scenario.description,
        measurement: 'n/a',
        sourceTokens: null,
        outputTokens: null,
        savedTokens: null,
        savedPct: null,
        outputPct: null,
        ratio: null,
      };
    }

    const toolStats = getAppState().getStatsSnapshot().session.byTool.find(
      tool => tool.tool === scenario.tool
    );
    if (!toolStats) {
      throw new Error(`Benchmark scenario "${scenario.tool}" did not produce tracked stats.`);
    }

    return {
      tool: scenario.tool,
      category: scenario.category,
      description: scenario.description,
      measurement: 'tracked',
      sourceTokens: toolStats.sourceTokens,
      outputTokens: toolStats.outputTokens,
      savedTokens: toolStats.totalSavedTokens,
      savedPct: toolStats.savedPctOfSource,
      outputPct: toolStats.outputPctOfSource,
      ratio: toolStats.sourceToOutputRatio,
    };
  } finally {
    await client.close();
    await server.close();
    resetAppStateForTests();
    DEFAULT_CONFIG.storage.stateDir = originalStateDir;
    process.chdir(originalCwd);
    rmSync(stateDir, { recursive: true, force: true });
    rmSync(workspaceDir, { recursive: true, force: true });
  }
}

function categorySummary(rows: BenchmarkRow[], category: BenchmarkCategory) {
  const tracked = rows.filter(row => row.category === category && row.measurement === 'tracked');
  if (tracked.length === 0) {
    return {
      tracked: 0,
      range: 'n/a',
      aggregateSavedPct: 'n/a',
      notes: 'Operational only.',
    };
  }

  const source = tracked.reduce((sum, row) => sum + (row.sourceTokens ?? 0), 0);
  const saved = tracked.reduce((sum, row) => sum + (row.savedTokens ?? 0), 0);
  const minSavedPct = Math.min(...tracked.map(row => row.savedPct ?? 0));
  const maxSavedPct = Math.max(...tracked.map(row => row.savedPct ?? 0));
  const aggregateSavedPct = source > 0 ? ((saved / source) * 100).toFixed(1) : '0.0';

  return {
    tracked: tracked.length,
    range: `${minSavedPct.toFixed(1)}% - ${maxSavedPct.toFixed(1)}%`,
    aggregateSavedPct: `${aggregateSavedPct}%`,
    notes: 'Local fixture range; not a guaranteed real-world outcome.',
  };
}

async function main(): Promise<void> {
  const exposedTools = TOOLS.map(tool => tool.name).sort();
  const scenarioTools = BENCHMARK_SCENARIOS.map(scenario => scenario.tool).sort();
  if (JSON.stringify(exposedTools) !== JSON.stringify(scenarioTools)) {
    throw new Error(
      `Benchmark scenarios are out of sync with exposed tools.\nExpected: ${exposedTools.join(', ')}\nReceived: ${scenarioTools.join(', ')}`
    );
  }

  const rows: BenchmarkRow[] = [];
  for (const scenario of BENCHMARK_SCENARIOS) {
    rows.push(await runScenario(scenario));
  }

  const trackedRows = rows.filter(row => row.measurement === 'tracked');
  const trackedSourceTokens = trackedRows.reduce((sum, row) => sum + (row.sourceTokens ?? 0), 0);
  const trackedOutputTokens = trackedRows.reduce((sum, row) => sum + (row.outputTokens ?? 0), 0);
  const trackedSavedTokens = trackedRows.reduce((sum, row) => sum + (row.savedTokens ?? 0), 0);
  const overallSavedPct =
    trackedSourceTokens > 0 ? ((trackedSavedTokens / trackedSourceTokens) * 100).toFixed(1) : '0.0';

  const categories: BenchmarkCategory[] = [
    'Compression & Execution',
    'Retrieval & Navigation',
    'Knowledge & Web',
    'Operational',
  ];

  const markdown = [
    '# Kanso Full Tool Benchmarks',
    '',
    '> Generated by `npm run benchmark` with deterministic local fixtures, mocked providers, and controlled tool inputs.',
    '> Savings ranges below are conservative benchmark expectations, not guarantees for every repo or workflow.',
    '',
    '## Overview',
    '',
    '| Metric | Value |',
    '|---|---|',
    `| Exposed tools benchmarked | ${rows.length} |`,
    `| Tracked savings tools | ${trackedRows.length} |`,
    `| Operational n/a tools | ${rows.length - trackedRows.length} |`,
    `| Aggregate tracked source | ${formatTokenValue(trackedSourceTokens)} |`,
    `| Aggregate tracked output | ${formatTokenValue(trackedOutputTokens)} |`,
    `| Aggregate tracked savings | ${formatTokenValue(trackedSavedTokens)} (${overallSavedPct}%) |`,
    '',
    '## Expected Savings By Category',
    '',
    '| Category | Tracked tools | Saved range | Aggregate saved | Notes |',
    '|---|---:|---:|---:|---|',
    ...categories.map(category => {
      const summary = categorySummary(rows, category);
      return `| ${category} | ${summary.tracked} | ${summary.range} | ${summary.aggregateSavedPct} | ${summary.notes} |`;
    }),
    '',
    '## Tool Stress Matrix',
    '',
    ...categories.flatMap(category => {
      const categoryRows = rows.filter(row => row.category === category);
      if (category === 'Operational') {
        return [
          `### ${category}`,
          '',
          '| Tool | Scenario | Savings |',
          '|---|---|---|',
          ...categoryRows.map(row => `| \`${row.tool}\` | ${row.description} | n/a |`),
          '',
        ];
      }

      return [
        `### ${category}`,
        '',
        '| Tool | Scenario | Source | Output | Saved | Output % | Reduction |',
        '|---|---|---:|---:|---:|---:|---:|',
        ...categoryRows.map(
          row =>
            `| \`${row.tool}\` | ${row.description} | ${formatTokenValue(row.sourceTokens)} | ${formatTokenValue(row.outputTokens)} | ${formatPct(row.savedPct)} | ${formatPct(row.outputPct)} | ${formatRatio(row.ratio)} |`
        ),
        '',
      ];
    }),
    '## Notes',
    '',
    '- `doctor`, `stats_report`, `stats_export`, and `stats_reset` are operational surfaces, so benchmark savings are intentionally `n/a`.',
    '- `web_search` uses a mocked provider response; `fetch_and_index` uses a local HTTP server; `structure_search` and `rewrite_preview` use a stubbed `sg` binary.',
    '- The benchmark measures Kanso tool output after the same response-optimization path used by the MCP server.',
    '',
    '## Reproduce',
    '',
    '```bash',
    'npm run benchmark',
    'npm run test:benchmarks',
    '```',
    '',
  ].join('\n');

  writeFileSync('BENCHMARK.md', markdown, 'utf8');
  console.log(markdown);
}

main().catch(error => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
