import { DEFAULT_CONFIG, type ResponseMode } from '../config/defaults.js';
import { contextResourceLink } from '../resources/registry.js';
import { asToolResult, type ToolExecutionResult } from './tool-result.js';
import {
  parseCursorLine,
  parsePositiveInteger,
  selectByQuery,
  selectLineRange,
  selectPage,
} from './file-selectors.js';
import { loadPathOrHandle } from './source-loader.js';

export interface ReadFileToolInput {
  path?: string;
  context_id?: string;
  start_line?: number;
  end_line?: number;
  query?: string;
  context_lines?: number;
  max_matches?: number;
  include_line_numbers?: boolean;
  cursor?: number | string;
  page_lines?: number;
  return_context_id?: boolean;
  max_output_tokens?: number;
  response_mode?: ResponseMode;
}

export async function readFileTool(
  input: ReadFileToolInput
): Promise<ToolExecutionResult | string> {
  const parsedStart = parsePositiveInteger(input.start_line, 'read_file.start_line');
  if (typeof parsedStart === 'string') return parsedStart;
  const parsedEnd = parsePositiveInteger(input.end_line, 'read_file.end_line');
  if (typeof parsedEnd === 'string') return parsedEnd;
  const parsedContextLines = parsePositiveInteger(input.context_lines, 'read_file.context_lines');
  if (typeof parsedContextLines === 'string') return parsedContextLines;
  const parsedMaxMatches = parsePositiveInteger(input.max_matches, 'read_file.max_matches');
  if (typeof parsedMaxMatches === 'string') return parsedMaxMatches;
  const parsedPageLines = parsePositiveInteger(input.page_lines, 'read_file.page_lines');
  if (typeof parsedPageLines === 'string') return parsedPageLines;
  const cursorLine = parseCursorLine(input.cursor);
  if (typeof cursorLine === 'string') return cursorLine;

  if (
    input.query &&
    (parsedStart !== undefined || parsedEnd !== undefined || cursorLine !== undefined)
  ) {
    return 'Error: read_file cannot combine query with line ranges or cursor paging';
  }
  if (parsedStart !== undefined && parsedEnd !== undefined && parsedEnd < parsedStart) {
    return 'Error: read_file.end_line must be >= read_file.start_line';
  }

  const loaded = await loadPathOrHandle(input, 'read_file');
  if (typeof loaded === 'string') return loaded;

  const responseMode = input.response_mode ?? DEFAULT_CONFIG.compression.responseMode;
  const includeLineNumbers = input.include_line_numbers ?? true;
  const contextLines = parsedContextLines ?? 2;
  const maxMatches = parsedMaxMatches ?? 20;
  const pageLines = parsedPageLines ?? (responseMode === 'full' ? 250 : 120);
  const showContextId = input.return_context_id ?? true;

  let text = '';
  let selectionLabel = 'page';
  const meta: string[] = [];

  if (input.query?.trim()) {
    const selected = selectByQuery(loaded.content, input.query.trim(), {
      contextLines,
      maxMatches,
      includeLineNumbers,
    });
    text = selected.text || '(no matches)';
    selectionLabel = 'query';
    meta.push(`matches: ${selected.totalMatches}`);
    meta.push(`showing: ${selected.shownMatches}`);
  } else if (parsedStart !== undefined || parsedEnd !== undefined) {
    const range = selectLineRange(loaded.content, parsedStart, parsedEnd, { includeLineNumbers });
    text = range.text;
    selectionLabel = 'range';
    meta.push(`lines: ${range.startLine}-${range.endLine}/${range.totalLines}`);
  } else {
    const page = selectPage(loaded.content, cursorLine, { includeLineNumbers, pageLines });
    text = page.text;
    selectionLabel = 'page';
    meta.push(`lines: ${page.startLine}-${page.endLine}/${page.totalLines}`);
    if (page.nextCursor) meta.push(`next_cursor: ${page.nextCursor}`);
  }

  const lines = [
    '=== Read File ===',
    `source: ${loaded.sourceLabel}`,
    `selection: ${selectionLabel}`,
    ...meta,
  ];
  if (showContextId) lines.push(`context_id: ${loaded.contextId}`);
  if (loaded.fromHandle) lines.push('handle: hit');
  lines.push(text || '(empty)');

  return asToolResult(lines.join('\n'), {
    sourceText: loaded.content,
    candidateText: text || lines.join('\n'),
    comparisonBasis: 'full_file',
    resourceLinks: [contextResourceLink(loaded.contextId, loaded.sourceLabel)],
  });
}
