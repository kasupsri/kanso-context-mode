import { DEFAULT_CONFIG, type ResponseMode } from '../config/defaults.js';
import { parsePositiveInteger } from './file-selectors.js';
import { treeFocus } from './workspace-helpers.js';

export interface TreeFocusToolInput {
  path?: string;
  depth?: number;
  max_entries?: number;
  include_hidden?: boolean;
  glob?: string;
  max_output_tokens?: number;
  response_mode?: ResponseMode;
}

function formatSize(sizeBytes?: number): string {
  if (typeof sizeBytes !== 'number' || !Number.isFinite(sizeBytes)) return '-';
  if (sizeBytes >= 1024 * 1024) return `${(sizeBytes / 1024 / 1024).toFixed(1)}MB`;
  if (sizeBytes >= 1024) return `${(sizeBytes / 1024).toFixed(1)}KB`;
  return `${sizeBytes}B`;
}

export async function treeFocusTool(input: TreeFocusToolInput = {}): Promise<string> {
  const parsedDepth = parsePositiveInteger(input.depth, 'tree_focus.depth');
  if (typeof parsedDepth === 'string') return parsedDepth;
  const parsedMaxEntries = parsePositiveInteger(input.max_entries, 'tree_focus.max_entries');
  if (typeof parsedMaxEntries === 'string') return parsedMaxEntries;

  const rootPath = input.path ?? process.cwd();
  const responseMode = input.response_mode ?? DEFAULT_CONFIG.compression.responseMode;
  const entries = await treeFocus({
    rootPath,
    depth: parsedDepth ?? 2,
    maxEntries: parsedMaxEntries ?? 200,
    includeHidden: input.include_hidden ?? false,
    glob: input.glob,
  });

  if (responseMode === 'minimal') {
    return [
      'ok:tree_focus',
      `path=${rootPath}`,
      `entries=${entries.length}`,
      ...entries.slice(0, 12).map(entry => `${entry.type}:${entry.relativePath}`),
    ].join('\n');
  }

  return [
    '=== Tree Focus ===',
    `path: ${rootPath}`,
    `entries: ${entries.length}`,
    ...entries.map(entry =>
      entry.type === 'directory'
        ? `[dir]  ${'  '.repeat(entry.depth)}${entry.relativePath}`
        : `[file] ${'  '.repeat(entry.depth)}${entry.relativePath} (${formatSize(entry.sizeBytes)})`
    ),
  ].join('\n');
}
