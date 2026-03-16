import { spawnSync } from 'child_process';
import { DEFAULT_CONFIG, type ResponseMode } from '../config/defaults.js';
import { parsePositiveInteger } from './file-selectors.js';
import { normalizeIncomingPath } from '../utils/path-input.js';

export interface RewritePreviewToolInput {
  pattern: string;
  rewrite: string;
  path?: string;
  language?: string;
  max_matches?: number;
  max_output_tokens?: number;
  response_mode?: ResponseMode;
}

function astGrepBinary(): string | null {
  for (const candidate of ['ast-grep', 'sg']) {
    const result = spawnSync(candidate, ['--version'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    if (result.status === 0) return candidate;
  }
  return null;
}

export function rewritePreviewTool(input: RewritePreviewToolInput): string {
  if (!input.pattern?.trim()) {
    return 'Error: rewrite_preview requires "pattern"';
  }
  if (!input.rewrite?.trim()) {
    return 'Error: rewrite_preview requires "rewrite"';
  }

  const parsedMaxMatches = parsePositiveInteger(input.max_matches, 'rewrite_preview.max_matches');
  if (typeof parsedMaxMatches === 'string') return parsedMaxMatches;
  const binary = astGrepBinary();
  if (!binary) {
    return 'Error: ast-grep CLI is not available. Install "ast-grep" or "sg" to use rewrite_preview.';
  }

  const rootPath = normalizeIncomingPath(input.path ?? process.cwd());
  const args = ['scan', '--pattern', input.pattern.trim(), '--rewrite', input.rewrite.trim()];
  if (input.language?.trim()) {
    args.push('--lang', input.language.trim());
  }
  args.push(rootPath);

  const result = spawnSync(binary, args, {
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
  });

  if (result.status !== 0 && result.status !== 1) {
    return `Error: ast-grep failed: ${result.stderr || result.stdout || `exit ${result.status}`}`;
  }

  const outputLines = (result.stdout || '')
    .split('\n')
    .filter(Boolean)
    .slice(0, Math.max(1, Math.min(parsedMaxMatches ?? 40, 200)));
  const responseMode = input.response_mode ?? DEFAULT_CONFIG.compression.responseMode;

  if (responseMode === 'minimal') {
    return [
      'ok:rewrite_preview',
      `path=${rootPath}`,
      `lines=${outputLines.length}`,
      ...outputLines.slice(0, 10),
    ].join('\n');
  }

  return [
    '=== Rewrite Preview ===',
    `path: ${rootPath}`,
    `pattern: ${input.pattern}`,
    `rewrite: ${input.rewrite}`,
    outputLines.length > 0 ? outputLines.join('\n') : '(no matches)',
  ].join('\n');
}
