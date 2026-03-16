import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../../../src/config/defaults.js';
import { AppState } from '../../../src/state/app-state.js';
import { cleanupTempStateDir, useTempStateDir } from '../test-helpers.js';

describe('stats schema reset', () => {
  let stateDir: string | undefined;

  afterEach(() => cleanupTempStateDir(stateDir));

  it('clears persisted stats rollups when the stats schema version changes', () => {
    stateDir = useTempStateDir('kcm-stats-schema-');

    const first = new AppState();
    first.recordCompressionEvent({
      tool: 'execute',
      strategy: 'ultra',
      changed: true,
      budgetForced: false,
      latencyMs: 5,
      sourceText: 'x'.repeat(1000),
      outputText: 'summary',
    });
    expect(first.getStatsSnapshot().allTime.project.totalSavedTokens).toBeGreaterThan(0);
    const dbPath = first.getDbPath();
    first.close();

    const db = new Database(dbPath);
    db.prepare(
      `INSERT INTO app_metadata (key, value, updated_at)
       VALUES ('stats_schema_version', '1', '2026-03-16T00:00:00.000Z')
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    ).run();
    db.close();

    DEFAULT_CONFIG.storage.stateDir = stateDir;
    const second = new AppState();
    const snapshot = second.getStatsSnapshot();
    expect(snapshot.schemaVersion).toBe(2);
    expect(snapshot.session.totalSavedTokens).toBe(0);
    expect(snapshot.allTime.project.totalSavedTokens).toBe(0);
    second.close();
  });
});
