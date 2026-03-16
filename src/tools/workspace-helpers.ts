import { execFile } from 'child_process';
import { readdir, readFile, stat } from 'fs/promises';
import { basename, join, relative, resolve } from 'path';
import { promisify } from 'util';
import { DEFAULT_CONFIG } from '../config/defaults.js';
import { evaluateFilePath } from '../security/policy.js';
import { selectByQuery, type QuerySelection } from './file-selectors.js';
import { normalizeIncomingPath } from '../utils/path-input.js';

const execFileAsync = promisify(execFile);
const DEFAULT_IGNORED_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.next',
  'target',
]);

export interface WorkspaceSearchOptions {
  rootPath: string;
  query: string;
  glob?: string;
  maxMatches?: number;
  contextLines?: number;
  caseSensitive?: boolean;
  wholeWord?: boolean;
  includeLineNumbers?: boolean;
}

export interface WorkspaceSearchMatch {
  path: string;
  relativePath: string;
  text: string;
  fullContent: string;
  totalMatches: number;
  shownMatches: number;
  matchedLines: number[];
}

export interface TreeFocusOptions {
  rootPath: string;
  depth?: number;
  maxEntries?: number;
  includeHidden?: boolean;
  glob?: string;
}

export interface TreeFocusEntry {
  path: string;
  relativePath: string;
  type: 'file' | 'directory';
  depth: number;
  sizeBytes?: number;
}

let rgAvailable: boolean | undefined;

function normalizeRoot(rootPath: string): string {
  return resolve(normalizeIncomingPath(rootPath || process.cwd()));
}

function normalizeQuery(query: string): string {
  return query.trim();
}

function globToRegExp(glob: string): RegExp {
  let regex = '';
  let i = 0;
  while (i < glob.length) {
    if (glob[i] === '*' && glob[i + 1] === '*') {
      if (glob[i + 2] === '/') {
        regex += '(.*/)?';
        i += 3;
      } else {
        regex += '.*';
        i += 2;
      }
    } else if (glob[i] === '*') {
      regex += '[^/]*';
      i += 1;
    } else if (glob[i] === '?') {
      regex += '[^/]';
      i += 1;
    } else {
      regex += (glob[i] ?? '').replace(/[.+^${}()|[\]\\/-]/g, '\\$&');
      i += 1;
    }
  }
  return new RegExp(`^${regex}$`, process.platform === 'win32' ? 'i' : '');
}

function matchesGlob(filePath: string, glob?: string): boolean {
  if (!glob?.trim()) return true;
  const normalized = filePath.replace(/\\/g, '/');
  return globToRegExp(glob.trim()).test(normalized);
}

function shouldSkipDir(name: string, includeHidden: boolean): boolean {
  if (DEFAULT_IGNORED_DIRS.has(name)) return true;
  if (!includeHidden && name.startsWith('.')) return true;
  return false;
}

async function isRgAvailable(): Promise<boolean> {
  if (rgAvailable !== undefined) return rgAvailable;
  try {
    const { stdout } = await execFileAsync('rg', ['--version'], {
      timeout: 2_000,
      windowsHide: true,
    });
    rgAvailable = stdout.toLowerCase().includes('ripgrep');
  } catch {
    rgAvailable = false;
  }
  return rgAvailable;
}

async function safeReadFile(path: string): Promise<string | null> {
  const denied = evaluateFilePath(path);
  if (denied.denied) return null;

  let fileStats;
  try {
    fileStats = await stat(path);
  } catch {
    return null;
  }

  if (!fileStats.isFile()) return null;
  if (fileStats.size > DEFAULT_CONFIG.sandbox.maxFileBytes) return null;

  try {
    const content = await readFile(path, 'utf8');
    return content.includes('\u0000') ? null : content;
  } catch {
    return null;
  }
}

async function collectMatchesWithRg(
  options: WorkspaceSearchOptions
): Promise<Map<string, number[]> | null> {
  if (!(await isRgAvailable())) return null;

  const query = normalizeQuery(options.query);
  if (!query) return new Map();

  const args = ['--json', '-n', '--no-heading', '--max-count', String(options.maxMatches ?? 20)];
  if (!(options.caseSensitive ?? false)) args.push('-i');
  if (options.wholeWord) args.push('-w');
  args.push('-F');
  if (options.glob?.trim()) {
    args.push('-g', options.glob.trim());
  }
  args.push(query, normalizeRoot(options.rootPath));

  try {
    const { stdout } = await execFileAsync('rg', args, {
      maxBuffer: 8 * 1024 * 1024,
      timeout: 15_000,
      windowsHide: true,
    });
    const matches = new Map<string, number[]>();

    for (const line of stdout.split('\n')) {
      if (!line.trim()) continue;
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (parsed['type'] !== 'match') continue;
      const data = parsed['data'] as Record<string, unknown> | undefined;
      const path = (data?.['path'] as { text?: string } | undefined)?.text;
      const lineNumber = data?.['line_number'];
      if (typeof path !== 'string' || typeof lineNumber !== 'number') continue;
      const list = matches.get(path) ?? [];
      list.push(Math.floor(lineNumber));
      matches.set(path, list);
    }

    return matches;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/code 1|status 1/i.test(message)) {
      return new Map();
    }
    return null;
  }
}

async function collectMatchesWithWalk(
  options: WorkspaceSearchOptions
): Promise<Map<string, number[]>> {
  const matches = new Map<string, number[]>();
  const rootPath = normalizeRoot(options.rootPath);
  const maxMatches = Math.max(1, Math.min(options.maxMatches ?? 20, 100));
  const query = normalizeQuery(options.query);
  if (!query) return matches;

  const walk = async (currentPath: string): Promise<void> => {
    const entries = await readdir(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = join(currentPath, entry.name);
      const relativePath = relative(rootPath, absolute).replace(/\\/g, '/');

      if (entry.isDirectory()) {
        if (shouldSkipDir(entry.name, true)) continue;
        await walk(absolute);
        continue;
      }

      if (!matchesGlob(relativePath, options.glob)) continue;
      const content = await safeReadFile(absolute);
      if (!content) continue;

      const selected = selectByQuery(content, query, {
        contextLines: options.contextLines ?? 2,
        maxMatches,
        includeLineNumbers: options.includeLineNumbers ?? true,
        caseSensitive: options.caseSensitive ?? true,
        wholeWord: options.wholeWord ?? false,
      });

      if (selected.totalMatches > 0) {
        const lineNumbers = selected.text
          .split('\n')
          .map(line => /^(\s*\d+)\|/.exec(line)?.[1]?.trim())
          .filter(Boolean)
          .map(line => Number.parseInt(line ?? '0', 10))
          .filter(value => Number.isFinite(value) && value > 0);
        matches.set(absolute, lineNumbers.slice(0, maxMatches));
      }
    }
  };

  await walk(rootPath);
  return matches;
}

function matchedLineNumbers(selection: QuerySelection): number[] {
  return selection.text
    .split('\n')
    .map(line => /^(\s*\d+)\|/.exec(line)?.[1]?.trim())
    .filter(Boolean)
    .map(line => Number.parseInt(line ?? '0', 10))
    .filter(value => Number.isFinite(value) && value > 0);
}

export async function searchWorkspace(
  options: WorkspaceSearchOptions
): Promise<WorkspaceSearchMatch[]> {
  const rootPath = normalizeRoot(options.rootPath);
  const query = normalizeQuery(options.query);
  if (!query) return [];

  const collected =
    (await collectMatchesWithRg(options)) ?? (await collectMatchesWithWalk(options));
  const result: WorkspaceSearchMatch[] = [];

  for (const [path] of collected.entries()) {
    const content = await safeReadFile(path);
    if (!content) continue;
    const selected = selectByQuery(content, query, {
      contextLines: options.contextLines ?? 2,
      maxMatches: options.maxMatches ?? 20,
      includeLineNumbers: options.includeLineNumbers ?? true,
      caseSensitive: options.caseSensitive ?? true,
      wholeWord: options.wholeWord ?? false,
    });
    if (selected.totalMatches === 0) continue;

    result.push({
      path,
      relativePath: relative(rootPath, path).replace(/\\/g, '/'),
      text: selected.text,
      fullContent: content,
      totalMatches: selected.totalMatches,
      shownMatches: selected.shownMatches,
      matchedLines: matchedLineNumbers(selected),
    });
  }

  return result.sort((a, b) => {
    if (a.totalMatches !== b.totalMatches) return b.totalMatches - a.totalMatches;
    return a.relativePath.localeCompare(b.relativePath);
  });
}

export async function treeFocus(options: TreeFocusOptions): Promise<TreeFocusEntry[]> {
  const rootPath = normalizeRoot(options.rootPath);
  const maxDepth = Math.max(0, Math.min(options.depth ?? 2, 8));
  const maxEntries = Math.max(1, Math.min(options.maxEntries ?? 200, 1000));
  const includeHidden = options.includeHidden ?? false;
  const entries: TreeFocusEntry[] = [];

  const walk = async (currentPath: string, depth: number): Promise<void> => {
    if (entries.length >= maxEntries) return;
    const dirents = await readdir(currentPath, { withFileTypes: true });
    for (const entry of dirents.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entries.length >= maxEntries) return;
      const absolute = join(currentPath, entry.name);
      const relativePath = relative(rootPath, absolute).replace(/\\/g, '/');
      if (entry.isDirectory()) {
        if (shouldSkipDir(entry.name, includeHidden)) continue;
        if (matchesGlob(relativePath || entry.name, options.glob)) {
          entries.push({
            path: absolute,
            relativePath: relativePath || basename(absolute),
            type: 'directory',
            depth,
          });
        }
        if (depth < maxDepth) {
          await walk(absolute, depth + 1);
        }
        continue;
      }

      if (!includeHidden && entry.name.startsWith('.')) continue;
      if (!matchesGlob(relativePath, options.glob)) continue;

      let sizeBytes: number | undefined;
      try {
        sizeBytes = (await stat(absolute)).size;
      } catch {
        sizeBytes = undefined;
      }

      entries.push({
        path: absolute,
        relativePath,
        type: 'file',
        depth,
        sizeBytes,
      });
    }
  };

  await walk(rootPath, 0);
  return entries;
}

export function scoreTaskTokens(task: string): string[] {
  return [...new Set(task.toLowerCase().match(/[a-z0-9_:-]{3,}/g) ?? [])];
}
