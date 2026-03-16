import { afterEach, describe, expect, it } from 'vitest';
import { getAppState, resetAppStateForTests } from '../../../src/state/index.js';
import { cleanupTempStateDir, useTempStateDir } from '../test-helpers.js';

let stateDir: string | undefined;

afterEach(() => {
  cleanupTempStateDir(stateDir);
  stateDir = undefined;
});

describe('app state hot cache', () => {
  it('flushes batched handle accesses before recent-handle reads', () => {
    stateDir = useTempStateDir('kcm-cache-');
    const state = getAppState();
    const alpha = state.saveHandle('alpha', 'alpha.ts');
    const beta = state.saveHandle('beta', 'beta.ts');

    expect(alpha.accessCount).toBe(0);

    state.getHandle(alpha.id);
    state.getHandle(alpha.id);
    state.getHandle(alpha.id);

    const recent = state.listRecentHandleSummaries(2);
    expect(recent[0]?.id).toBe(alpha.id);
    expect(recent[0]?.accessCount).toBe(3);
    expect(recent[1]?.id).toBe(beta.id);
  });

  it('persists queued handle access counts across app-state resets', () => {
    stateDir = useTempStateDir('kcm-cache-persist-');
    const state = getAppState();
    const handle = state.saveHandle('persist me', 'persist.ts');

    state.getHandle(handle.id);
    state.getHandle(handle.id);

    resetAppStateForTests();

    const reopened = getAppState();
    const stored = reopened.listRecentHandles(1)[0];
    expect(stored?.id).toBe(handle.id);
    expect(stored?.accessCount).toBe(2);
  });
});
