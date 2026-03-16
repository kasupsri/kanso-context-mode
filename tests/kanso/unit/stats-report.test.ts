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
    expect(report).toContain('SESSION');
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
    expect(after).toContain('Total saved:');
  });
});
