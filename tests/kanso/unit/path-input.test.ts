import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { detectHost } from '../../../src/runtime/host.js';
import { normalizeIncomingPath } from '../../../src/utils/path-input.js';

describe('path input normalization', () => {
  it('converts WSL and Git Bash style paths on Windows hosts', () => {
    expect(normalizeIncomingPath('/mnt/c/Work/Kasup/project', 'win32')).toBe(
      'C:\\Work\\Kasup\\project'
    );
    expect(normalizeIncomingPath('/c/Users/test/project', 'win32')).toBe(
      'C:\\Users\\test\\project'
    );
  });

  it('leaves Unix paths unchanged on non-Windows hosts', () => {
    expect(normalizeIncomingPath('/mnt/c/Work/Kasup/project', 'linux')).toBe(
      '/mnt/c/Work/Kasup/project'
    );
  });
});

describe('host detection', () => {
  it('prefers workspace markers over unrelated home-directory heuristics', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'kcm-host-cwd-'));
    const home = mkdtempSync(join(tmpdir(), 'kcm-host-home-'));

    try {
      writeFileSync(join(cwd, 'AGENTS.md'), '# codex workspace', 'utf8');
      mkdirSync(join(home, '.claude'));

      const host = detectHost({
        cwd,
        homeDir: home,
        env: {} as NodeJS.ProcessEnv,
      });

      expect(host.id).toBe('codex');
      expect(host.reason).toContain('workspace');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });
});
