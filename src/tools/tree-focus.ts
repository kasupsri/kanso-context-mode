import { DEFAULT_CONFIG, type ResponseMode } from '../config/defaults.js';
import { asToolResult, type ToolExecutionResult } from './tool-result.js';
import { parsePositiveInteger } from './file-selectors.js';
import { treeFocus } from './workspace-helpers.js';
import { normalizeIncomingPath } from '../utils/path-input.js';

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

export async function treeFocusTool(input: TreeFocusToolInput = {}): Promise<ToolExecutionResult> {
  const parsedDepth = parsePositiveInteger(input.depth, 'tree_focus.depth');
  if (typeof parsedDepth === 'string') return asToolResult(parsedDepth);
  const parsedMaxEntries = parsePositiveInteger(input.max_entries, 'tree_focus.max_entries');
  if (typeof parsedMaxEntries === 'string') return asToolResult(parsedMaxEntries);

  const rootPath = normalizeIncomingPath(input.path ?? process.cwd());
  const responseMode = input.response_mode ?? DEFAULT_CONFIG.compression.responseMode;
  const entries = await treeFocus({
    rootPath,
    depth: parsedDepth ?? 2,
    maxEntries: parsedMaxEntries ?? 200,
    includeHidden: input.include_hidden ?? false,
    glob: input.glob,
  });
  const sourceText = entries
    .map(entry =>
      [
        `type=${entry.type}`,
        `path=${entry.relativePath}`,
        `depth=${entry.depth}`,
        typeof entry.sizeBytes === 'number' ? `size=${entry.sizeBytes}` : '',
      ]
        .filter(Boolean)
        .join(' ')
    )
    .join('\n');

  if (responseMode === 'minimal') {
    return asToolResult(
      [
        'ok:tree_focus',
        `path=${rootPath}`,
        `entries=${entries.length}`,
        ...entries.slice(0, 12).map(entry => `${entry.type}:${entry.relativePath}`),
      ].join('\n'),
      {
        sourceText,
        comparisonBasis: 'workspace_source',
      }
    );
  }

  const text = [
    '=== Tree Focus ===',
    `path: ${rootPath}`,
    `entries: ${entries.length}`,
    ...entries.map(entry =>
      entry.type === 'directory'
        ? `[dir]  ${'  '.repeat(entry.depth)}${entry.relativePath}`
        : `[file] ${'  '.repeat(entry.depth)}${entry.relativePath} (${formatSize(entry.sizeBytes)})`
    ),
  ].join('\n');

  return asToolResult(text, {
    sourceText,
    candidateText: text,
    comparisonBasis: 'workspace_source',
  });
}
