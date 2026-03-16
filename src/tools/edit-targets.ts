import { execFile } from 'child_process';
import { readFile, stat } from 'fs/promises';
import { relative, resolve } from 'path';
import { promisify } from 'util';
import { DEFAULT_CONFIG, type ResponseMode } from '../config/defaults.js';
import { getAppState } from '../state/index.js';
import { contextResourceLink } from '../resources/registry.js';
import { asToolResult, type ToolExecutionResult } from './tool-result.js';
import { parsePositiveInteger } from './file-selectors.js';
import { extractSymbolsWithTreeSitter } from './symbol-parser.js';
import { scoreTaskTokens, searchWorkspace } from './workspace-helpers.js';
import { normalizeIncomingPath } from '../utils/path-input.js';

const execFileAsync = promisify(execFile);

export interface EditTargetsToolInput {
  task: string;
  paths?: string[];
  max_files?: number;
  include_symbols?: boolean;
  include_references?: boolean;
  max_output_tokens?: number;
  response_mode?: ResponseMode;
}

interface RankedTarget {
  path: string;
  relativePath: string;
  score: number;
  reasons: Set<string>;
  lines: Set<number>;
}

async function changedFiles(rootPath: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync('git', ['diff', '--name-only', '--cached', '--', '.'], {
      cwd: rootPath,
      timeout: 10_000,
      windowsHide: true,
    });
    const staged = stdout
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean);
    const unstagedOut = await execFileAsync('git', ['diff', '--name-only', '--', '.'], {
      cwd: rootPath,
      timeout: 10_000,
      windowsHide: true,
    });
    const unstaged = unstagedOut.stdout
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean);
    return [...new Set([...staged, ...unstaged])];
  } catch {
    return [];
  }
}

async function safeContent(path: string): Promise<string | null> {
  try {
    const fileStats = await stat(path);
    if (!fileStats.isFile() || fileStats.size > DEFAULT_CONFIG.sandbox.maxFileBytes) return null;
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}

export async function editTargetsTool(input: EditTargetsToolInput): Promise<ToolExecutionResult> {
  if (!input.task?.trim()) {
    return asToolResult('Error: edit_targets requires "task"');
  }

  const parsedMaxFiles = parsePositiveInteger(input.max_files, 'edit_targets.max_files');
  if (typeof parsedMaxFiles === 'string') return asToolResult(parsedMaxFiles);

  const rootPath = resolve(normalizeIncomingPath((input.paths && input.paths[0]) || process.cwd()));
  const tokens = scoreTaskTokens(input.task).slice(0, 6);
  const ranked = new Map<string, RankedTarget>();
  const ensureTarget = (path: string): RankedTarget => {
    const existing = ranked.get(path);
    if (existing) return existing;
    const target: RankedTarget = {
      path,
      relativePath: relative(rootPath, path).replace(/\\/g, '/'),
      score: 0,
      reasons: new Set(),
      lines: new Set(),
    };
    ranked.set(path, target);
    return target;
  };

  const recentFiles = getAppState().listRecentSessionValues('file', 12);
  for (const file of recentFiles) {
    const absolute = resolve(rootPath, file);
    const target = ensureTarget(absolute);
    target.score += 3;
    target.reasons.add('recent_file');
  }

  for (const file of await changedFiles(rootPath)) {
    const absolute = resolve(rootPath, file);
    const target = ensureTarget(absolute);
    target.score += 2;
    target.reasons.add('recent_change');
  }

  for (const token of tokens) {
    const matches = await searchWorkspace({
      rootPath,
      query: token,
      maxMatches: 6,
      contextLines: 1,
      caseSensitive: false,
      wholeWord: false,
      includeLineNumbers: true,
    });

    for (const match of matches.slice(0, 20)) {
      const target = ensureTarget(match.path);
      target.score += Math.min(5, match.totalMatches);
      target.reasons.add('content');
      for (const line of match.matchedLines.slice(0, 5)) {
        target.lines.add(line);
      }
    }
  }

  for (const target of ranked.values()) {
    const lowerPath = target.relativePath.toLowerCase();
    for (const token of tokens) {
      if (lowerPath.includes(token)) {
        target.score += 4;
        target.reasons.add('filename');
      }
    }
  }

  if (input.include_symbols ?? true) {
    const candidates = [...ranked.values()]
      .sort((a, b) => b.score - a.score || a.relativePath.localeCompare(b.relativePath))
      .slice(0, 10);

    for (const candidate of candidates) {
      const content = await safeContent(candidate.path);
      if (!content) continue;
      const symbols = (await extractSymbolsWithTreeSitter(candidate.path, content)) ?? [];
      const lowerSymbols = symbols.map(symbol => `${symbol.kind}:${symbol.name.toLowerCase()}`);
      for (const token of tokens) {
        if (lowerSymbols.some(symbol => symbol.includes(token))) {
          candidate.score += 3;
          candidate.reasons.add('symbol');
        }
      }
    }
  }

  const sorted = [...ranked.values()]
    .filter(target => target.score > 0)
    .sort((a, b) => b.score - a.score || a.relativePath.localeCompare(b.relativePath))
    .slice(0, parsedMaxFiles ?? 8);

  const responseMode = input.response_mode ?? DEFAULT_CONFIG.compression.responseMode;
  const text =
    sorted.length === 0
      ? responseMode === 'minimal'
        ? `edit_targets none task="${input.task.trim()}"`
        : `No likely edit targets found for "${input.task.trim()}".`
      : responseMode === 'minimal'
        ? [
            `edit_targets files=${sorted.length} task="${input.task.trim()}"`,
            ...sorted.map(
              target =>
                `${target.relativePath} score=${target.score} reasons=${[...target.reasons].join(',')}`
            ),
          ].join('\n')
        : [
            '=== Edit Targets ===',
            `task: ${input.task.trim()}`,
            `files: ${sorted.length}`,
            ...sorted.map(target =>
              [
                '',
                `### ${target.relativePath}`,
                `score: ${target.score}`,
                `reasons: ${[...target.reasons].join(', ')}`,
                target.lines.size > 0
                  ? `line_hints: ${[...target.lines].sort((a, b) => a - b).join(', ')}`
                  : '',
              ]
                .filter(Boolean)
                .join('\n')
            ),
          ].join('\n');

  const contextId =
    sorted.length > 0
      ? getAppState().saveHandle(text, `edit_targets:${input.task.trim()}`).id
      : undefined;

  return asToolResult(text, {
    sourceText: sorted
      .map(
        target =>
          `${target.relativePath}\nscore=${target.score}\nreasons=${[...target.reasons].join(',')}`
      )
      .join('\n\n'),
    candidateText: text,
    comparisonBasis: 'workspace_source',
    resourceLinks: contextId
      ? [contextResourceLink(contextId, `edit_targets:${input.task.trim()}`)]
      : [],
  });
}
