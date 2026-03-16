import { spawnSync } from 'child_process';
import { DEFAULT_CONFIG, type ResponseMode } from '../config/defaults.js';
import { parsePositiveInteger } from './file-selectors.js';
import { normalizeIncomingPath } from '../utils/path-input.js';

export interface StructureSearchToolInput {
  pattern: string;
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

function parseAstGrepOutput(stdout: string): Array<Record<string, unknown>> {
  const trimmed = stdout.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.filter(item => item && typeof item === 'object') as Array<
        Record<string, unknown>
      >;
    }
  } catch {
    // Fall through to NDJSON parsing.
  }

  return trimmed
    .split('\n')
    .map(line => {
      try {
        return JSON.parse(line) as Record<string, unknown>;
      } catch {
        return null;
      }
    })
    .filter((item): item is Record<string, unknown> => Boolean(item));
}

export function structureSearchTool(input: StructureSearchToolInput): string {
  if (!input.pattern?.trim()) {
    return 'Error: structure_search requires "pattern"';
  }

  const parsedMaxMatches = parsePositiveInteger(input.max_matches, 'structure_search.max_matches');
  if (typeof parsedMaxMatches === 'string') return parsedMaxMatches;
  const binary = astGrepBinary();
  if (!binary) {
    return 'Error: ast-grep CLI is not available. Install "ast-grep" or "sg" to use structure_search.';
  }

  const rootPath = normalizeIncomingPath(input.path ?? process.cwd());
  const args = ['scan', '--json', '--pattern', input.pattern.trim()];
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

  const matches = parseAstGrepOutput(result.stdout).slice(0, parsedMaxMatches ?? 20);
  const responseMode = input.response_mode ?? DEFAULT_CONFIG.compression.responseMode;

  if (responseMode === 'minimal') {
    return [
      'ok:structure_search',
      `path=${rootPath}`,
      `matches=${matches.length}`,
      ...matches.slice(0, 8).map(match => {
        const file = typeof match['file'] === 'string' ? match['file'] : 'unknown';
        const start = (match['range'] as { start?: { line?: number } } | undefined)?.start?.line;
        return `${file}:${typeof start === 'number' ? start + 1 : '?'}`;
      }),
    ].join('\n');
  }

  return [
    '=== Structure Search ===',
    `path: ${rootPath}`,
    `pattern: ${input.pattern}`,
    `matches: ${matches.length}`,
    ...matches.map(match => {
      const file = typeof match['file'] === 'string' ? match['file'] : 'unknown';
      const lines = match['lines'];
      const range = match['range'] as
        | { start?: { line?: number }; end?: { line?: number } }
        | undefined;
      const start = typeof range?.start?.line === 'number' ? range.start.line + 1 : '?';
      const end = typeof range?.end?.line === 'number' ? range.end.line + 1 : '?';
      return `- ${file}:${start}-${end}\n${typeof lines === 'string' ? lines.trim() : ''}`;
    }),
  ].join('\n');
}
