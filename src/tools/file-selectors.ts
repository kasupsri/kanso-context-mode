export interface SelectorRenderOptions {
  includeLineNumbers?: boolean;
}

export interface LineRangeSelection {
  text: string;
  startLine: number;
  endLine: number;
  totalLines: number;
}

export interface QuerySelection {
  text: string;
  totalLines: number;
  totalMatches: number;
  shownMatches: number;
}

export interface PageSelection {
  text: string;
  startLine: number;
  endLine: number;
  totalLines: number;
  nextCursor?: string;
}

export interface QuerySelectionOptions extends SelectorRenderOptions {
  contextLines?: number;
  maxMatches?: number;
  caseSensitive?: boolean;
  wholeWord?: boolean;
}

export interface PageSelectionOptions extends SelectorRenderOptions {
  pageLines?: number;
}

const DEFAULT_CONTEXT_LINES = 2;
const DEFAULT_MAX_MATCHES = 20;
const DEFAULT_PAGE_LINES = 200;

export function parsePositiveInteger(
  value: unknown,
  fieldLabel: string
): number | string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return `Error: ${fieldLabel} must be a positive number`;
  }
  return Math.floor(value);
}

function normalizeText(content: string): string {
  return content.replace(/\r\n/g, '\n');
}

export function splitLines(content: string): string[] {
  return normalizeText(content).split('\n');
}

function formatLine(
  lineNumber: number,
  line: string,
  width: number,
  includeLineNumbers: boolean
): string {
  if (!includeLineNumbers) return line;
  return `${String(lineNumber).padStart(width, ' ')}| ${line}`;
}

function clampLine(line: number, totalLines: number): number {
  return Math.min(Math.max(line, 1), totalLines);
}

export function selectLineRange(
  content: string,
  startLine?: number,
  endLine?: number,
  render: SelectorRenderOptions = {}
): LineRangeSelection {
  const lines = splitLines(content);
  const totalLines = Math.max(1, lines.length);
  const includeLineNumbers = render.includeLineNumbers ?? true;

  const start = clampLine(startLine ?? 1, totalLines);
  const end = clampLine(endLine ?? totalLines, totalLines);
  const effectiveEnd = Math.max(start, end);
  const width = String(totalLines).length;
  const out: string[] = [];

  for (let lineNo = start; lineNo <= effectiveEnd; lineNo += 1) {
    out.push(formatLine(lineNo, lines[lineNo - 1] ?? '', width, includeLineNumbers));
  }

  return {
    text: out.join('\n'),
    startLine: start,
    endLine: effectiveEnd,
    totalLines,
  };
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface LineRange {
  start: number;
  end: number;
}

function mergeRanges(ranges: LineRange[]): LineRange[] {
  if (ranges.length === 0) return [];
  const sorted = ranges
    .slice()
    .sort((a, b) => (a.start !== b.start ? a.start - b.start : a.end - b.end));

  const merged: LineRange[] = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (!last || range.start > last.end + 1) {
      merged.push({ start: range.start, end: range.end });
      continue;
    }
    last.end = Math.max(last.end, range.end);
  }
  return merged;
}

export function selectByQuery(
  content: string,
  query: string,
  options: QuerySelectionOptions = {}
): QuerySelection {
  const lines = splitLines(content);
  const totalLines = Math.max(1, lines.length);
  const includeLineNumbers = options.includeLineNumbers ?? true;
  const contextLines = options.contextLines ?? DEFAULT_CONTEXT_LINES;
  const maxMatches = options.maxMatches ?? DEFAULT_MAX_MATCHES;
  const caseSensitive = options.caseSensitive ?? true;
  const wholeWord = options.wholeWord ?? false;

  if (!query.trim()) {
    return { text: '', totalLines, totalMatches: 0, shownMatches: 0 };
  }

  const queryRegex = wholeWord
    ? new RegExp(`\\b${escapeRegExp(query)}\\b`, caseSensitive ? '' : 'i')
    : null;
  const normalizedQuery = caseSensitive ? query : query.toLowerCase();

  const matches: number[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    const matched = queryRegex
      ? queryRegex.test(line)
      : caseSensitive
        ? line.includes(normalizedQuery)
        : line.toLowerCase().includes(normalizedQuery);
    if (matched) {
      matches.push(i + 1);
    }
  }

  const chosenMatches = matches.slice(0, Math.max(1, maxMatches));
  const ranges = chosenMatches.map(lineNo => ({
    start: Math.max(1, lineNo - Math.max(0, contextLines)),
    end: Math.min(totalLines, lineNo + Math.max(0, contextLines)),
  }));
  const merged = mergeRanges(ranges);
  const width = String(totalLines).length;
  const out: string[] = [];

  for (let i = 0; i < merged.length; i += 1) {
    const range = merged[i]!;
    if (i > 0) out.push('...');
    for (let lineNo = range.start; lineNo <= range.end; lineNo += 1) {
      out.push(formatLine(lineNo, lines[lineNo - 1] ?? '', width, includeLineNumbers));
    }
  }

  return {
    text: out.join('\n'),
    totalLines,
    totalMatches: matches.length,
    shownMatches: chosenMatches.length,
  };
}

export function parseCursorLine(value: unknown): number | string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const num =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number.parseInt(value, 10)
        : Number.NaN;
  if (!Number.isFinite(num) || num <= 0) {
    return 'Error: cursor must be a positive integer line number';
  }
  return Math.floor(num);
}

export function selectPage(
  content: string,
  cursorLine?: number,
  options: PageSelectionOptions = {}
): PageSelection {
  const lines = splitLines(content);
  const totalLines = Math.max(1, lines.length);
  const includeLineNumbers = options.includeLineNumbers ?? true;
  const pageLines = Math.max(1, Math.floor(options.pageLines ?? DEFAULT_PAGE_LINES));
  const start = clampLine(cursorLine ?? 1, totalLines);
  const end = clampLine(start + pageLines - 1, totalLines);
  const width = String(totalLines).length;
  const out: string[] = [];

  for (let lineNo = start; lineNo <= end; lineNo += 1) {
    out.push(formatLine(lineNo, lines[lineNo - 1] ?? '', width, includeLineNumbers));
  }

  const hasMore = end < totalLines;
  return {
    text: out.join('\n'),
    startLine: start,
    endLine: end,
    totalLines,
    nextCursor: hasMore ? String(end + 1) : undefined,
  };
}
