import { afterEach, describe, expect, it } from 'vitest';
import { getAppState } from '../../../src/state/index.js';
import { statsReportTool } from '../../../src/tools/stats-report.js';
import { statsResetTool } from '../../../src/tools/stats-reset.js';
import { cleanupTempStateDir, useTempStateDir } from '../test-helpers.js';

let stateDir: string | undefined;

afterEach(() => cleanupTempStateDir(stateDir));

describe('stats reporting', () => {
  it('reports session and all-time estimated savings', () => {
    stateDir = useTempStateDir();
    const state = getAppState();

    state.recordCompressionEvent({
      tool: 'execute',
      strategy: 'ultra',
      changed: true,
      budgetForced: false,
      latencyMs: 12,
      inputText: 'x'.repeat(4000),
      outputText: 'summary',
      tokenProfile: 'generic',
    });

    const report = statsReportTool({ response_mode: 'full' });
    const snapshot = state.getStatsSnapshot();
    expect(snapshot.schemaVersion).toBe(2);
    expect(snapshot.session.savedPctOfSource).toBeGreaterThan(0);
    expect(snapshot.session.outputPctOfSource).toBeGreaterThanOrEqual(0);
    expect(snapshot.session.topTool?.name).toBe('execute');
    expect(snapshot.session.topTool?.shareOfSavings).toBe(100);
    expect(snapshot.session.sourceToOutputRatio).not.toBeNull();
    expect(snapshot.session.avgSavedTokensPerEvent).toBeGreaterThan(0);
    expect(snapshot.session.retrievalPctOfSaved + snapshot.session.compressionPctOfSaved).toBe(100);
    expect(snapshot.session.changedPct).toBe(100);
    expect(report).toContain('SESSION');
    expect(report).toContain('SUMMARY');
    expect(report).toContain('ALL TIME (PROJECT)');
    expect(report).toContain('estimated');
  });

  it('resets the session window without erasing all-time rollups', () => {
    stateDir = useTempStateDir();
    const state = getAppState();

    state.recordCompressionEvent({
      tool: 'read_file',
      strategy: 'ultra',
      changed: true,
      budgetForced: false,
      latencyMs: 3,
      inputText: 'y'.repeat(2000),
      outputText: 'short',
      tokenProfile: 'generic',
    });

    const before = statsReportTool({ response_mode: 'full' });
    expect(before).toContain('read_file');

    const reset = statsResetTool({ response_mode: 'full' });
    expect(reset).toContain('New session');

    const after = statsReportTool({ response_mode: 'full' });
    expect(after).toContain('ALL TIME (PROJECT)');
    expect(after).toContain('Saved % of source');
  });

  it('keeps total savings positive when a source proxy is smaller than the candidate text', () => {
    stateDir = useTempStateDir();
    const state = getAppState();

    state.recordCompressionEvent({
      tool: 'search',
      strategy: 'summarize',
      changed: true,
      budgetForced: true,
      latencyMs: 4,
      sourceText: 'kb=stress-local\nbytes=100\ntokens=10',
      candidateText: 'candidate '.repeat(120),
      outputText: 'short summary',
      tokenProfile: 'generic',
    });

    const searchTotals = state
      .getStatsSnapshot()
      .session.byTool.find(tool => tool.tool === 'search');
    expect(searchTotals?.compressionSavedTokens).toBeGreaterThan(0);
    expect(searchTotals?.totalSavedTokens).toBe(
      (searchTotals?.retrievalSavedTokens ?? 0) + (searchTotals?.compressionSavedTokens ?? 0)
    );
    expect(searchTotals?.totalSavedTokens).toBeGreaterThan(0);
  });

  it('shows a friendly zero-data report before tracked tool usage', () => {
    stateDir = useTempStateDir();

    const report = statsReportTool({ response_mode: 'full' });
    expect(report).toContain('No tracked Kanso activity yet.');
    expect(report).not.toContain('BY TOOL');
  });
});
