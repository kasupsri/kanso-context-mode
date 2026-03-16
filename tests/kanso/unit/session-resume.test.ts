import { afterEach, describe, expect, it } from 'vitest';
import { getAppState } from '../../../src/state/index.js';
import { cleanupTempStateDir, useTempStateDir } from '../test-helpers.js';

describe('session resume', () => {
  let cleanupDir: string | undefined;

  afterEach(() => {
    cleanupTempStateDir(cleanupDir);
    cleanupDir = undefined;
  });

  it('keeps the newest events when the snapshot is capped', () => {
    cleanupDir = useTempStateDir('kcm-session-resume-');
    const state = getAppState();

    for (let index = 0; index < 12; index += 1) {
      state.recordSessionEvents(
        'codex',
        [
          {
            type: 'task',
            category: 'task',
            priority: 1,
            data: `task-${index}`,
          },
        ],
        'session-1'
      );
    }

    const snapshot = state.buildSessionResume({
      host: 'codex',
      externalSessionId: 'session-1',
      maxEvents: 5,
    });

    expect(snapshot.eventCount).toBe(5);
    expect(snapshot.text).toContain('task-11');
    expect(snapshot.text).toContain('task-7');
    expect(snapshot.text).not.toContain('task-0');
    expect(snapshot.text).not.toContain('task-4');
  });
});
