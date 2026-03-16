import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { DEFAULT_CONFIG } from '../../src/config/defaults.js';
import { resetAppStateForTests } from '../../src/state/index.js';
import { resetTokenEstimatorForTests } from '../../src/utils/token-estimator.js';

export function useTempStateDir(prefix = 'kcm-test-'): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  DEFAULT_CONFIG.storage.stateDir = dir;
  resetAppStateForTests();
  resetTokenEstimatorForTests();
  return dir;
}

export function cleanupTempStateDir(dir: string | undefined): void {
  resetAppStateForTests();
  resetTokenEstimatorForTests();
  if (dir) {
    rmSync(dir, { recursive: true, force: true });
  }
}
