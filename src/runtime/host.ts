import { existsSync } from 'fs';
import { homedir } from 'os';
import { join, resolve } from 'path';

export type HostId = 'claude' | 'cursor' | 'codex' | 'generic';

export interface HostInfo {
  id: HostId;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
}

export function detectHost(): HostInfo {
  if (process.env['CLAUDE_PROJECT_DIR'] || process.env['CLAUDE_SESSION_ID']) {
    return {
      id: 'claude',
      confidence: 'high',
      reason: 'Claude env detected',
    };
  }

  if (process.env['CURSOR_TRACE_ID'] || process.env['CURSOR_CLI']) {
    return {
      id: 'cursor',
      confidence: 'high',
      reason: 'Cursor env detected',
    };
  }

  if (process.env['CODEX_CI'] || process.env['CODEX_THREAD_ID']) {
    return {
      id: 'codex',
      confidence: 'high',
      reason: 'Codex env detected',
    };
  }

  const home = homedir();
  if (existsSync(resolve(home, '.claude'))) {
    return {
      id: 'claude',
      confidence: 'medium',
      reason: '~/.claude exists',
    };
  }

  if (existsSync(resolve(home, '.cursor'))) {
    return {
      id: 'cursor',
      confidence: 'medium',
      reason: '~/.cursor exists',
    };
  }

  if (existsSync(resolve(home, '.codex')) || existsSync(join(home, '.codex', 'config.toml'))) {
    return {
      id: 'codex',
      confidence: 'medium',
      reason: '~/.codex exists',
    };
  }

  return {
    id: 'generic',
    confidence: 'low',
    reason: 'No host-specific signal detected',
  };
}
