import { existsSync } from 'fs';
import { homedir } from 'os';
import { join, resolve } from 'path';

export type HostId = 'claude' | 'cursor' | 'codex' | 'generic';

export interface HostInfo {
  id: HostId;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
}

interface DetectHostOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
}

function detectWorkspaceHost(cwd: string): HostInfo | null {
  if (existsSync(join(cwd, 'AGENTS.md')) || existsSync(join(cwd, '.codex'))) {
    return {
      id: 'codex',
      confidence: 'medium',
      reason: 'Codex workspace markers detected',
    };
  }

  if (existsSync(join(cwd, '.cursor')) || existsSync(join(cwd, '.cursor', 'mcp.json'))) {
    return {
      id: 'cursor',
      confidence: 'medium',
      reason: 'Cursor workspace markers detected',
    };
  }

  if (existsSync(join(cwd, 'CLAUDE.md')) || existsSync(join(cwd, '.claude'))) {
    return {
      id: 'claude',
      confidence: 'medium',
      reason: 'Claude workspace markers detected',
    };
  }

  return null;
}

export function detectHost(options: DetectHostOptions = {}): HostInfo {
  const env = options.env ?? process.env;

  if (env['CLAUDE_PROJECT_DIR'] || env['CLAUDE_SESSION_ID']) {
    return {
      id: 'claude',
      confidence: 'high',
      reason: 'Claude env detected',
    };
  }

  if (env['CURSOR_TRACE_ID'] || env['CURSOR_CLI']) {
    return {
      id: 'cursor',
      confidence: 'high',
      reason: 'Cursor env detected',
    };
  }

  if (env['CODEX_CI'] || env['CODEX_THREAD_ID']) {
    return {
      id: 'codex',
      confidence: 'high',
      reason: 'Codex env detected',
    };
  }

  const workspaceHost = detectWorkspaceHost(resolve(options.cwd ?? process.cwd()));
  if (workspaceHost) {
    return workspaceHost;
  }

  const home = options.homeDir ?? homedir();
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
