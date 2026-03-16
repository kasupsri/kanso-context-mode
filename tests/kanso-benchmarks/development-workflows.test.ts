import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../../src/config/defaults.js';
import { AppState } from '../../src/state/app-state.js';

type StorageProfile = {
  hotCacheMB: number;
  hotCacheEntries: number;
  hotCacheTtlMs: number;
  cleanupEveryWrites: number;
};

const originalStorage = structuredClone(DEFAULT_CONFIG.storage);
const balancedProfile: StorageProfile = {
  hotCacheMB: originalStorage.hotCacheMB,
  hotCacheEntries: originalStorage.hotCacheEntries,
  hotCacheTtlMs: originalStorage.hotCacheTtlMs,
  cleanupEveryWrites: originalStorage.cleanupEveryWrites,
};

afterEach(() => {
  Object.assign(DEFAULT_CONFIG.storage, originalStorage);
});

function runHandleWorkload(
  profile: StorageProfile,
  options: { handleCount: number; reads: number; hotSet: number }
) {
  const dir = mkdtempSync(join(tmpdir(), 'kcm-bench-'));
  Object.assign(DEFAULT_CONFIG.storage, {
    ...originalStorage,
    ...profile,
    stateDir: dir,
  });

  const state = new AppState();
  const payload = 'x'.repeat(18_000);
  const handleIds: string[] = [];

  try {
    for (let i = 0; i < options.handleCount; i += 1) {
      handleIds.push(state.saveHandle(`${payload}-${i}`, `file-${i}.ts`).id);
    }

    for (let i = 0; i < options.reads; i += 1) {
      const handle = state.getHandle(handleIds[i % options.hotSet]);
      expect(handle?.content.startsWith('x')).toBe(true);
    }

    return state.getCacheStats();
  } finally {
    state.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('development workflow cache profiles', () => {
  it('keeps a typical working set hot without growing beyond the configured budget', () => {
    const lean = runHandleWorkload(
      {
        hotCacheMB: 2,
        hotCacheEntries: 16,
        hotCacheTtlMs: 5 * 60 * 1000,
        cleanupEveryWrites: 25,
      },
      { handleCount: 48, reads: 4000, hotSet: 48 }
    );
    const balanced = runHandleWorkload(balancedProfile, {
      handleCount: 48,
      reads: 4000,
      hotSet: 48,
    });

    expect(lean.misses).toBeGreaterThan(0);
    expect(balanced.misses).toBe(0);
    expect(balanced.bytes).toBeLessThanOrEqual(balancedProfile.hotCacheMB * 1024 * 1024);
  });

  it('reduces misses on a larger rotating working set compared with a lean profile', () => {
    const lean = runHandleWorkload(
      {
        hotCacheMB: 2,
        hotCacheEntries: 16,
        hotCacheTtlMs: 5 * 60 * 1000,
        cleanupEveryWrites: 25,
      },
      { handleCount: 96, reads: 6000, hotSet: 96 }
    );
    const balanced = runHandleWorkload(balancedProfile, {
      handleCount: 96,
      reads: 6000,
      hotSet: 96,
    });

    expect(balanced.misses).toBeLessThan(lean.misses);
    expect(balanced.hits).toBeGreaterThan(lean.hits);
  });
});
