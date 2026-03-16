import { execFile } from 'child_process';
import { stat } from 'fs/promises';
import { promisify } from 'util';
import { DEFAULT_CONFIG, type ResponseMode } from '../config/defaults.js';
import { evaluateFilePath } from '../security/policy.js';
import { parsePositiveInteger } from './file-selectors.js';

const execFileAsync = promisify(execFile);

export interface GitFocusToolInput {
  repo_path?: string;
  base_ref?: string;
  scope?: 'working' | 'staged' | 'unstaged';
  max_files?: number;
  max_hunks_per_file?: number;
  include_hunks?: boolean;
  max_output_tokens?: number;
  response_mode?: ResponseMode;
}

interface GitDiffData {
  numstat: string;
  nameStatus: string;
  patch: string;
}

interface FileSummary {
  file: string;
  added: number;
  deleted: number;
  statuses: Set<string>;
  symbols: Set<string>;
  hunks: string[];
}

const SYMBOL_PATTERNS = [
  /(?:function|class|interface|type|enum|const|let|var)\s+([A-Za-z_$][\w$]*)/,
  /^\s*def\s+([A-Za-z_][\w]*)/,
  /^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_][\w]*)/,
  /^\s*(?:pub\s+)?fn\s+([A-Za-z_][\w]*)/,
];

function validateRef(ref: string): boolean {
  return /^[A-Za-z0-9._/:-]+$/.test(ref);
}

async function runGit(args: string[], cwd: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd,
      timeout: 15_000,
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
    });
    return stdout;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`git ${args.join(' ')} failed: ${msg}`);
  }
}

async function ensureRepo(repoPath: string): Promise<string | null> {
  try {
    const out = await runGit(['rev-parse', '--is-inside-work-tree'], repoPath);
    return out.trim() === 'true' ? null : `Error: "${repoPath}" is not a git repository`;
  } catch (err) {
    return `Error: unable to access git repository at "${repoPath}": ${String(err)}`;
  }
}

async function collectDiff(
  repoPath: string,
  options: { baseRef?: string; staged?: boolean }
): Promise<GitDiffData> {
  const argsPrefix = ['diff'];
  if (options.staged) argsPrefix.push('--cached');
  const refRange = options.baseRef ? [`${options.baseRef}...HEAD`] : [];

  const numstat = await runGit([...argsPrefix, '--numstat', ...refRange], repoPath);
  const nameStatus = await runGit([...argsPrefix, '--name-status', ...refRange], repoPath);
  const patch = await runGit([...argsPrefix, '--no-color', '--unified=0', ...refRange], repoPath);
  return { numstat, nameStatus, patch };
}

function getOrCreateSummary(map: Map<string, FileSummary>, file: string): FileSummary {
  const existing = map.get(file);
  if (existing) return existing;
  const summary: FileSummary = {
    file,
    added: 0,
    deleted: 0,
    statuses: new Set(),
    symbols: new Set(),
    hunks: [],
  };
  map.set(file, summary);
  return summary;
}

function mergeNumstat(target: Map<string, FileSummary>, text: string): void {
  const lines = text.split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;
    const parts = line.split('\t');
    if (parts.length < 3) continue;
    const added = parts[0] === '-' ? 0 : Number.parseInt(parts[0] ?? '0', 10) || 0;
    const deleted = parts[1] === '-' ? 0 : Number.parseInt(parts[1] ?? '0', 10) || 0;
    const file = (parts[2] ?? '').trim();
    if (!file) continue;
    const summary = getOrCreateSummary(target, file);
    summary.added += added;
    summary.deleted += deleted;
  }
}

function mergeNameStatus(target: Map<string, FileSummary>, text: string): void {
  const lines = text.split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;
    const parts = line.split('\t');
    if (parts.length < 2) continue;
    const status = (parts[0] ?? '').trim();
    const file = (parts[parts.length - 1] ?? '').trim();
    if (!file) continue;
    const summary = getOrCreateSummary(target, file);
    if (status) summary.statuses.add(status);
  }
}

function extractSymbol(line: string): string | undefined {
  const text = line.trim();
  for (const pattern of SYMBOL_PATTERNS) {
    const match = pattern.exec(text);
    if (match?.[1]) return match[1];
  }
  return undefined;
}

function mergePatch(
  target: Map<string, FileSummary>,
  patch: string,
  maxHunksPerFile: number,
  includeHunks: boolean
): void {
  const lines = patch.split('\n');
  let currentFile = '';
  let currentHunk: string[] | null = null;

  for (const line of lines) {
    const diffMatch = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
    if (diffMatch) {
      currentFile = diffMatch[2] ?? diffMatch[1] ?? '';
      currentHunk = null;
      continue;
    }

    if (!currentFile) continue;
    const summary = getOrCreateSummary(target, currentFile);

    if (line.startsWith('@@')) {
      if (!includeHunks || summary.hunks.length >= maxHunksPerFile) {
        currentHunk = null;
        continue;
      }
      currentHunk = [line];
      summary.hunks.push('');
      continue;
    }

    if (
      (line.startsWith('+') || line.startsWith('-')) &&
      !line.startsWith('+++') &&
      !line.startsWith('---')
    ) {
      const symbol = extractSymbol(line.slice(1));
      if (symbol) summary.symbols.add(symbol);

      if (currentHunk && currentHunk.length < 7) {
        currentHunk.push(line);
        summary.hunks[summary.hunks.length - 1] = currentHunk.join('\n');
      }
    }
  }
}

function compactStatus(statuses: Set<string>): string {
  if (statuses.size === 0) return 'M';
  return [...statuses].join(',');
}

export async function gitFocusTool(input: GitFocusToolInput = {}): Promise<string> {
  const repoPath = input.repo_path ?? process.cwd();
  const responseMode = input.response_mode ?? DEFAULT_CONFIG.compression.responseMode;
  const parsedMaxFiles = parsePositiveInteger(input.max_files, 'git_focus.max_files');
  if (typeof parsedMaxFiles === 'string') return parsedMaxFiles;
  const parsedMaxHunks = parsePositiveInteger(
    input.max_hunks_per_file,
    'git_focus.max_hunks_per_file'
  );
  if (typeof parsedMaxHunks === 'string') return parsedMaxHunks;
  const maxFiles = parsedMaxFiles ?? 50;
  const maxHunksPerFile = parsedMaxHunks ?? 3;
  const includeHunks = input.include_hunks ?? true;

  const denied = evaluateFilePath(repoPath);
  if (denied.denied) {
    return `Blocked by security policy: file path matches "${denied.matchedPattern}"`;
  }

  try {
    const st = await stat(repoPath);
    if (!st.isDirectory()) {
      return `Error: repo_path "${repoPath}" is not a directory`;
    }
  } catch (err) {
    return `Error: cannot access repo_path "${repoPath}": ${String(err)}`;
  }

  if (input.base_ref && !validateRef(input.base_ref)) {
    return 'Error: git_focus.base_ref contains unsupported characters';
  }

  const repoErr = await ensureRepo(repoPath);
  if (repoErr) return repoErr;

  const summaries = new Map<string, FileSummary>();
  const baseRef = input.base_ref?.trim() || undefined;
  const scope = input.scope ?? 'working';

  try {
    if (baseRef) {
      const data = await collectDiff(repoPath, { baseRef });
      mergeNumstat(summaries, data.numstat);
      mergeNameStatus(summaries, data.nameStatus);
      mergePatch(summaries, data.patch, maxHunksPerFile, includeHunks);
    } else if (scope === 'staged') {
      const data = await collectDiff(repoPath, { staged: true });
      mergeNumstat(summaries, data.numstat);
      mergeNameStatus(summaries, data.nameStatus);
      mergePatch(summaries, data.patch, maxHunksPerFile, includeHunks);
    } else if (scope === 'unstaged') {
      const data = await collectDiff(repoPath, {});
      mergeNumstat(summaries, data.numstat);
      mergeNameStatus(summaries, data.nameStatus);
      mergePatch(summaries, data.patch, maxHunksPerFile, includeHunks);
    } else {
      const unstaged = await collectDiff(repoPath, {});
      const staged = await collectDiff(repoPath, { staged: true });
      mergeNumstat(summaries, unstaged.numstat);
      mergeNumstat(summaries, staged.numstat);
      mergeNameStatus(summaries, unstaged.nameStatus);
      mergeNameStatus(summaries, staged.nameStatus);
      mergePatch(summaries, unstaged.patch, maxHunksPerFile, includeHunks);
      mergePatch(summaries, staged.patch, maxHunksPerFile, includeHunks);
    }
  } catch (err) {
    return `Error: git_focus failed: ${String(err)}`;
  }

  const files = [...summaries.values()].sort((a, b) => {
    const aDelta = a.added + a.deleted;
    const bDelta = b.added + b.deleted;
    if (aDelta !== bDelta) return bDelta - aDelta;
    return a.file.localeCompare(b.file);
  });

  const shown = files.slice(0, maxFiles);
  const totalAdded = files.reduce((sum, file) => sum + file.added, 0);
  const totalDeleted = files.reduce((sum, file) => sum + file.deleted, 0);

  if (responseMode === 'minimal') {
    return [
      'ok:git_focus',
      `scope=${baseRef ? 'base' : scope}`,
      `files=${files.length}`,
      `shown=${shown.length}`,
      `added=${totalAdded}`,
      `deleted=${totalDeleted}`,
    ].join(' ');
  }

  const out: string[] = [];
  for (const file of shown) {
    const symbols = [...file.symbols].slice(0, 8).join(', ') || '-';
    out.push(
      `- [${compactStatus(file.statuses)}] ${file.file} (+${file.added} -${file.deleted}) symbols: ${symbols}`
    );
    if (includeHunks && file.hunks.length > 0) {
      for (const hunk of file.hunks.slice(0, maxHunksPerFile)) {
        if (!hunk) continue;
        out.push(`  ${hunk.replace(/\n/g, '\n  ')}`);
      }
    }
  }

  const scopeLabel = baseRef ? `base:${baseRef}...HEAD` : scope;
  return [
    '=== Git Focus ===',
    `repo: ${repoPath}`,
    `scope: ${scopeLabel}`,
    `files_changed: ${files.length}`,
    `showing: ${shown.length}`,
    `total_added: ${totalAdded}`,
    `total_deleted: ${totalDeleted}`,
    files.length === 0 ? '(no changes)' : out.join('\n'),
  ].join('\n');
}
