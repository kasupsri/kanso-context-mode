/**
 * Content-type-aware compression strategies.
 * All algorithmic — no LLM calls, no API dependencies.
 */

import { filterByIntent } from './intent-filter.js';
import { DEFAULT_CONFIG } from '../config/defaults.js';

export type ContentType =
  | 'json'
  | 'log'
  | 'code'
  | 'markdown'
  | 'csv'
  | 'diff'
  | 'stacktrace'
  | 'env'
  | 'generic';
export type CompressionStrategy = 'auto' | 'truncate' | 'summarize' | 'filter' | 'ultra' | 'as-is';

export interface CompressOptions {
  intent?: string;
  maxOutputChars?: number;
  headLines?: number;
  tailLines?: number;
  strategy?: CompressionStrategy;
  parsedJson?: unknown;
}

export interface CompressResult {
  output: string;
  strategy: CompressionStrategy;
  contentType: ContentType;
  inputChars: number;
  outputChars: number;
  savedPercent: number;
}

const DEFAULT_MAX_CHARS = 8000;

// ─── Content Type Detection ──────────────────────────────────────────────────

export function detectContentType(text: string): ContentType {
  const trimmed = text.trimStart();

  // JSON: starts with { or [ and is parseable
  if ((trimmed.startsWith('{') || trimmed.startsWith('[')) && isValidJson(trimmed)) {
    return 'json';
  }

  if (/^(diff --git|--- a\/|\+\+\+ b\/|@@ )/m.test(trimmed)) return 'diff';
  if (looksLikeStackTrace(trimmed)) return 'stacktrace';
  if (looksLikeEnv(trimmed)) return 'env';

  // CSV/log detection only needs a handful of lines.
  const firstLines = takeFirstLines(trimmed, 5);
  if (looksLikeCsv(firstLines)) return 'csv';

  // Log: timestamp patterns at line starts
  if (looksLikeLog(firstLines)) return 'log';

  // Code: significant code indicators
  if (looksLikeCode(trimmed)) return 'code';

  // Markdown: heading or fence patterns
  if (looksLikeMarkdown(trimmed)) return 'markdown';

  return 'generic';
}

function detectContentTypeWithParsed(text: string, parsedJson?: unknown): ContentType {
  if (parsedJson !== undefined) return 'json';
  const trimmed = text.trimStart();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    const firstLines = takeFirstLines(trimmed, 5);
    if (looksLikeCsv(firstLines)) return 'csv';
    if (looksLikeLog(firstLines)) return 'log';
    if (looksLikeCode(trimmed)) return 'code';
    if (looksLikeMarkdown(trimmed)) return 'markdown';
    return 'generic';
  }
  return detectContentType(trimmed);
}

function tryParseJson(text: string): unknown | undefined {
  const trimmed = text.trimStart();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    return undefined;
  }
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return undefined;
  }
}

function isValidJson(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

function takeFirstLines(text: string, maxLines: number): string[] {
  if (maxLines <= 0 || !text) return [];

  const lines: string[] = [];
  let start = 0;

  while (lines.length < maxLines) {
    const newlineIdx = text.indexOf('\n', start);
    if (newlineIdx === -1) {
      lines.push(text.slice(start));
      break;
    }
    lines.push(text.slice(start, newlineIdx));
    start = newlineIdx + 1;
  }

  return lines;
}

function clampToMaxChars(text: string, maxChars: number): string {
  return text.length > maxChars ? text.slice(0, maxChars) : text;
}

function resolveMaxOutputChars(maxOutputChars?: number): number {
  if (typeof maxOutputChars === 'number' && Number.isFinite(maxOutputChars) && maxOutputChars > 0) {
    return Math.floor(maxOutputChars);
  }

  const configured = DEFAULT_CONFIG.compression.maxOutputBytes;
  if (Number.isFinite(configured) && configured > 0) {
    return Math.floor(configured);
  }

  return DEFAULT_MAX_CHARS;
}

function looksLikeCsv(lines: string[]): boolean {
  if (lines.length < 2) return false;
  const delimiters = [',', '\t', ';', '|'];
  for (const delim of delimiters) {
    const counts = lines.map(l => l.split(delim).length);
    const consistent = counts.every(c => c === counts[0] && c > 1);
    if (consistent) return true;
  }
  return false;
}

function looksLikeLog(lines: string[]): boolean {
  const logPatterns = [
    /^\d{4}-\d{2}-\d{2}/, // ISO date
    /^\[\d{2}:\d{2}:\d{2}\]/, // [HH:MM:SS]
    /^[A-Z]{4,5}:/, // INFO: WARN: ERROR:
    /^\d{13}\s/, // Unix ms timestamp
  ];
  const matchCount = lines.filter(l => logPatterns.some(p => p.test(l))).length;
  return matchCount >= Math.min(2, lines.length);
}

function looksLikeCode(text: string): boolean {
  const codeIndicators = [
    /^(function|const|let|var|class|import|export|def|fn |pub |async)\s/m,
    /[{}]\s*$/m,
    /=>\s*\{/,
    /^\s{2,}(if|for|while|return)\s/m,
  ];
  return codeIndicators.filter(p => p.test(text)).length >= 2;
}

function looksLikeMarkdown(text: string): boolean {
  return /^#{1,6}\s/m.test(text) || /^```/m.test(text) || /^\s*[-*]\s/m.test(text);
}

function looksLikeStackTrace(text: string): boolean {
  return (
    (/at\s+[\w.<>$]+\s*\(/.test(text) && /Error:|Exception:/.test(text)) ||
    (/Traceback \(most recent call last\)/i.test(text) && /File ".+", line \d+/.test(text)) ||
    (/thread '.+' panicked at/.test(text) && /stack backtrace/.test(text))
  );
}

function looksLikeEnv(text: string): boolean {
  const lines = text
    .split('\n')
    .slice(0, 10)
    .filter(line => line.trim() && !line.trim().startsWith('#'));
  const matches = lines.filter(line => /^[A-Z_][A-Z0-9_]*\s*=/.test(line)).length;
  return matches >= Math.min(2, lines.length) && matches > 0;
}

// ─── Compression Strategies ──────────────────────────────────────────────────

function compressJson(
  text: string,
  maxChars: number,
  intent?: string,
  parsedJson?: unknown
): string {
  if (intent) return filterByIntent(text, intent, maxChars);

  const parsed = parsedJson ?? tryParseJson(text);
  if (parsed === undefined) return genericTruncate(text, maxChars, 50, 20);
  return summarizeJson(parsed, maxChars);
}

function summarizeJson(value: unknown, maxChars: number, depth = 0): string {
  const lines: string[] = [];

  if (Array.isArray(value)) {
    lines.push(`Array[${value.length}]`);
    if (value.length > 0) {
      lines.push(`  Type: ${getJsonType(value[0])}`);
      // Show structure of first element
      if (typeof value[0] === 'object' && value[0] !== null) {
        lines.push(`  Keys: ${Object.keys(value[0] as object).join(', ')}`);
      }
      // Show first 3 items summarized
      const sample = value.slice(0, 3);
      lines.push(`  Sample (${sample.length} of ${value.length}):`);
      for (const item of sample) {
        lines.push(`    ${JSON.stringify(item).slice(0, 200)}`);
      }
    }
  } else if (typeof value === 'object' && value !== null) {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj);
    lines.push(`Object {${keys.length} keys}`);
    lines.push(`Keys: ${keys.slice(0, 30).join(', ')}${keys.length > 30 ? '...' : ''}`);
    if (depth < 2) {
      for (const key of keys.slice(0, 15)) {
        const val = obj[key];
        if (Array.isArray(val)) {
          lines.push(`  ${key}: Array[${val.length}]`);
        } else if (typeof val === 'object' && val !== null) {
          lines.push(`  ${key}: Object{${Object.keys(val).join(', ').slice(0, 60)}}`);
        } else {
          lines.push(`  ${key}: ${JSON.stringify(val)?.slice(0, 100) ?? 'null'}`);
        }
      }
      if (keys.length > 15) lines.push(`  ... and ${keys.length - 15} more keys`);
    }
  } else {
    lines.push(JSON.stringify(value) ?? 'null');
  }

  return clampToMaxChars(lines.join('\n'), maxChars);
}

function getJsonType(value: unknown): string {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  return typeof value;
}

function compressLog(text: string, maxChars: number, intent?: string): string {
  if (intent) return filterByIntent(text, intent, maxChars);

  const lines = text.split('\n');
  const totalLines = lines.length;

  // Bound memory and CPU for very large logs.
  const MAX_TRACKED_PATTERNS = 300;
  const MAX_ERRORS = 25;
  const MAX_WARNINGS = 25;

  const patterns: Map<string, { count: number; example: string }> = new Map();
  const errors: string[] = [];
  const warnings: string[] = [];
  let droppedPatternTracking = 0;

  for (const line of lines) {
    // Normalize timestamps and IDs for pattern matching.
    const normalized = line
      .replace(/\d{4}-\d{2}-\d{2}T?\d{2}:\d{2}:\d{2}(\.\d+)?Z?/g, '<TIMESTAMP>')
      .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<UUID>')
      .replace(/\b\d+\b/g, '<N>');

    const existing = patterns.get(normalized);
    if (existing) {
      existing.count++;
    } else if (patterns.size < MAX_TRACKED_PATTERNS) {
      patterns.set(normalized, { count: 1, example: line });
    } else {
      droppedPatternTracking++;
    }

    if (/\b(error|exception|fatal|panic|critical)\b/i.test(line)) {
      if (errors.length < MAX_ERRORS) errors.push(line.slice(0, 220));
    } else if (/\b(warn|warning)\b/i.test(line)) {
      if (warnings.length < MAX_WARNINGS) warnings.push(line.slice(0, 180));
    }
  }

  const result: string[] = [`=== Log Summary: ${totalLines} lines ===`, ''];

  if (errors.length > 0) {
    result.push(`ERRORS(sample=${errors.length}):`);
    result.push(...errors.slice(0, 10).map(e => `  ${e}`));
    if (errors.length > 10) result.push(`  ...${errors.length - 10} more`);
    result.push('');
  }

  if (warnings.length > 0) {
    result.push(`WARN(sample=${warnings.length}):`);
    result.push(...warnings.slice(0, 5).map(w => `  ${w}`));
    if (warnings.length > 5) result.push(`  ...${warnings.length - 5} more`);
    result.push('');
  }

  const sorted = Array.from(patterns.entries())
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 20);

  result.push('TOP PATTERNS:');
  for (const [, { count, example }] of sorted) {
    if (count > 1) {
      result.push(`  [x${count}] ${example.slice(0, 120)}`);
    }
  }

  if (droppedPatternTracking > 0) {
    result.push('');
    result.push(`...${droppedPatternTracking} pattern(s) not tracked`);
  }

  return clampToMaxChars(result.join('\n'), maxChars);
}

function compressCode(text: string, maxChars: number, intent?: string): string {
  if (intent) return filterByIntent(text, intent, maxChars);

  const lines = text.split('\n');
  const result: string[] = [];
  let inBlock = false;
  let braceDepth = 0;
  let blockLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // Always include comments and top-level signatures
    if (
      trimmed.startsWith('//') ||
      trimmed.startsWith('#') ||
      trimmed.startsWith('/*') ||
      trimmed.startsWith('*')
    ) {
      result.push(line);
      continue;
    }

    // Detect function/class signatures
    const isSig =
      /^(export\s+)?(async\s+)?function\s+\w+|^(export\s+)?(abstract\s+)?class\s+\w+|^\s*(public|private|protected|static|async)?\s*\w+\s*\(/.test(
        trimmed
      );
    const isArrow = /^(export\s+)?(const|let)\s+\w+\s*=\s*(async\s+)?\(/.test(trimmed);
    const isDecorator = trimmed.startsWith('@');
    const isImport = /^(import|from)\s/.test(trimmed);
    const isType = /^(type|interface|enum)\s/.test(trimmed);

    if (isImport || isType || isDecorator) {
      result.push(line);
      continue;
    }

    if (isSig || isArrow) {
      if (inBlock && blockLines.length > 0) {
        result.push('  // ... body omitted');
        result.push('}');
      }
      inBlock = true;
      braceDepth = 0;
      blockLines = [];
      result.push(line);
      // Count opening braces
      braceDepth += (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length;
      if (braceDepth <= 0) inBlock = false;
      continue;
    }

    if (inBlock) {
      braceDepth += (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length;
      blockLines.push(line);
      if (braceDepth <= 0) {
        result.push('  // ... body omitted');
        result.push('}');
        inBlock = false;
        blockLines = [];
      }
      continue;
    }

    result.push(line);
  }

  return clampToMaxChars(result.join('\n'), maxChars);
}

function compressMarkdown(text: string, maxChars: number, intent?: string): string {
  if (intent) return filterByIntent(text, intent, maxChars);

  const lines = text.split('\n');
  const result: string[] = [];
  let inCodeBlock = false;
  let inSection = false;
  let sectionLineCount = 0;
  const MAX_SECTION_LINES = 3;

  for (const line of lines) {
    if (/^```/.test(line)) {
      inCodeBlock = !inCodeBlock;
      if (inCodeBlock) {
        result.push(line);
        result.push('  // ... code block omitted');
      } else {
        result.push(line);
      }
      continue;
    }

    if (inCodeBlock) continue; // skip code block content

    // Always include headings
    if (/^#{1,6}\s/.test(line)) {
      result.push('');
      result.push(line);
      inSection = true;
      sectionLineCount = 0;
      continue;
    }

    if (inSection && sectionLineCount < MAX_SECTION_LINES) {
      result.push(line);
      sectionLineCount++;
      if (sectionLineCount === MAX_SECTION_LINES && line.trim()) {
        result.push('  ...');
      }
    }
  }

  return clampToMaxChars(result.join('\n').trim(), maxChars);
}

function compressCsv(text: string, maxChars: number, intent?: string): string {
  if (intent) return filterByIntent(text, intent, maxChars);

  const lines = text.split('\n').filter(l => l.trim());
  if (lines.length === 0) return text;

  // Detect delimiter
  const delimiters = [',', '\t', ';', '|'];
  let delimiter = ',';
  for (const d of delimiters) {
    if ((lines[0] ?? '').includes(d)) {
      delimiter = d;
      break;
    }
  }

  const header = lines[0] ?? '';
  const columns = header.split(delimiter);
  const dataRows = lines.slice(1);
  const parsedRows = dataRows.map(row => row.split(delimiter));
  const totalRows = parsedRows.length;

  const result: string[] = [
    `=== CSV: ${columns.length} columns × ${totalRows + 1} rows ===`,
    '',
    `Columns: ${columns.join(', ')}`,
    '',
    `Sample rows (first 5 of ${totalRows}):`,
  ];

  // Show first 5 data rows
  for (const row of dataRows.slice(0, 5)) {
    result.push(`  ${row.slice(0, 200)}`);
  }

  if (totalRows > 5) {
    result.push(`  ... and ${totalRows - 5} more rows`);
  }

  // Basic stats for numeric columns
  const numericStats = computeCsvStats(parsedRows, columns);
  if (numericStats.length > 0) {
    result.push('');
    result.push('Numeric column stats:');
    for (const stat of numericStats) {
      result.push(`  ${stat.column}: min=${stat.min}, max=${stat.max}, avg=${stat.avg.toFixed(2)}`);
    }
  }

  return clampToMaxChars(result.join('\n'), maxChars);
}

function compressDiff(text: string, maxChars: number, intent?: string): string {
  if (intent) return filterByIntent(text, intent, maxChars);

  const lines = text.split('\n');
  const files: Array<{ file: string; added: number; removed: number; symbols: string[] }> = [];
  let current: { file: string; added: number; removed: number; symbols: string[] } | null = null;

  for (const line of lines) {
    const diffMatch = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
    if (diffMatch) {
      current = {
        file: diffMatch[2] ?? diffMatch[1] ?? 'unknown',
        added: 0,
        removed: 0,
        symbols: [],
      };
      files.push(current);
      continue;
    }

    if (!current) continue;

    if (line.startsWith('+') && !line.startsWith('+++')) {
      current.added += 1;
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      current.removed += 1;
    }

    if (
      (line.startsWith('+') || line.startsWith('-')) &&
      !line.startsWith('+++') &&
      !line.startsWith('---')
    ) {
      const symbolMatch =
        /(?:function|class|interface|type|enum|const|let|var)\s+([A-Za-z_$][\w$]*)/.exec(line);
      const symbol = symbolMatch?.[1];
      if (symbol && !current.symbols.includes(symbol) && current.symbols.length < 6) {
        current.symbols.push(symbol);
      }
    }
  }

  const result = ['=== Diff Summary ===', `files: ${files.length}`];
  for (const file of files.slice(0, 12)) {
    result.push(
      `${file.file} +${file.added} -${file.removed}${file.symbols.length > 0 ? ` symbols:${file.symbols.join(',')}` : ''}`
    );
  }
  if (files.length > 12) result.push(`... and ${files.length - 12} more files`);
  return clampToMaxChars(result.join('\n'), maxChars);
}

function compressStackTrace(text: string, maxChars: number, intent?: string): string {
  if (intent) return filterByIntent(text, intent, maxChars);

  const lines = text.split('\n').filter(Boolean);
  const headline =
    lines.find(line => /Error:|Exception:|panic/i.test(line)) ?? lines[0] ?? 'stack trace';
  const frames = lines
    .filter(line => /\bat\b|File ".+", line \d+|stack backtrace/i.test(line))
    .slice(0, 8);
  const result = ['=== Stack Trace ===', headline, ...frames];
  return clampToMaxChars(result.join('\n'), maxChars);
}

function compressEnv(text: string, maxChars: number, intent?: string): string {
  if (intent) return filterByIntent(text, intent, maxChars);

  const lines = text.split('\n');
  const result = ['=== Env Summary ==='];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = /^([A-Z_][A-Z0-9_]*)\s*=(.*)$/.exec(trimmed);
    if (!match) continue;
    const key = match[1] ?? 'UNKNOWN';
    const value = match[2] ?? '';
    const masked = /secret|password|token|key|auth|credential/i.test(key)
      ? '<redacted>'
      : value.slice(0, 40);
    result.push(`${key}=${masked}`);
    if (result.length >= 20) break;
  }
  return clampToMaxChars(result.join('\n'), maxChars);
}

function computeCsvStats(
  rows: string[][],
  columns: string[]
): Array<{ column: string; min: number; max: number; avg: number }> {
  const stats: Array<{ column: string; min: number; max: number; avg: number }> = [];
  const totals = columns.map(() => ({
    count: 0,
    min: Number.POSITIVE_INFINITY,
    max: Number.NEGATIVE_INFINITY,
    sum: 0,
  }));

  for (const row of rows) {
    for (let colIdx = 0; colIdx < columns.length; colIdx++) {
      const cell = row[colIdx]?.trim() ?? '';
      const num = Number.parseFloat(cell);
      if (Number.isNaN(num)) continue;

      const total = totals[colIdx]!;
      total.count++;
      total.sum += num;
      if (num < total.min) total.min = num;
      if (num > total.max) total.max = num;
    }
  }

  for (let colIdx = 0; colIdx < columns.length; colIdx++) {
    const total = totals[colIdx]!;
    if (total.count <= rows.length * 0.5) continue;
    stats.push({
      column: columns[colIdx] ?? `col${colIdx}`,
      min: total.min,
      max: total.max,
      avg: total.sum / Math.max(total.count, 1),
    });
  }

  return stats;
}

function compressUltra(
  text: string,
  contentType: ContentType,
  maxChars: number,
  parsedJson?: unknown
): string {
  switch (contentType) {
    case 'json':
      return ultraJson(text, maxChars, parsedJson);
    case 'log':
      return ultraLog(text, maxChars);
    case 'markdown':
      return ultraMarkdown(text, maxChars);
    case 'csv':
      return ultraCsv(text, maxChars);
    case 'code':
      return ultraCode(text, maxChars);
    case 'diff':
      return compressDiff(text, maxChars);
    case 'stacktrace':
      return compressStackTrace(text, maxChars);
    case 'env':
      return compressEnv(text, maxChars);
    default:
      return ultraGeneric(text, maxChars);
  }
}

function ultraJson(text: string, maxChars: number, parsedJson?: unknown): string {
  const parsed = parsedJson ?? tryParseJson(text);
  if (parsed === undefined) return ultraGeneric(text, maxChars);

  if (Array.isArray(parsed)) {
    const parsedArray = parsed as unknown[];
    const first = parsedArray[0];
    const second = parsedArray[1];
    const keys =
      first && typeof first === 'object' && !Array.isArray(first)
        ? Object.keys(first as object)
            .slice(0, 8)
            .join(',')
        : '';
    const lines = [
      `json:a n=${parsedArray.length} t=${getJsonType(first)}`,
      keys ? `keys:${keys}` : '',
      first !== undefined ? `s1:${JSON.stringify(first).slice(0, 120)}` : '',
      second !== undefined ? `s2:${JSON.stringify(second).slice(0, 120)}` : '',
    ]
      .filter(Boolean)
      .join('\n');
    return clampToMaxChars(lines, maxChars);
  }

  if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    const keys = Object.keys(obj);
    const lines = [`json:o keys=${keys.length}`, `k:${keys.slice(0, 15).join(',')}`];
    return clampToMaxChars(lines.join('\n'), maxChars);
  }

  return clampToMaxChars(`json:v ${JSON.stringify(parsed) ?? 'null'}`, maxChars);
}

function ultraLog(text: string, maxChars: number): string {
  const lines = text.split('\n');
  let errCount = 0;
  let warnCount = 0;
  const errSamples: string[] = [];
  const warnSamples: string[] = [];

  for (const line of lines) {
    if (/\b(error|exception|fatal|panic|critical)\b/i.test(line)) {
      errCount++;
      if (errSamples.length < 3) errSamples.push(line.slice(0, 120));
      continue;
    }
    if (/\b(warn|warning)\b/i.test(line)) {
      warnCount++;
      if (warnSamples.length < 2) warnSamples.push(line.slice(0, 100));
    }
  }

  const out = [
    `log lines=${lines.length} err=${errCount} warn=${warnCount}`,
    ...errSamples.map(line => `e:${line}`),
    ...warnSamples.map(line => `w:${line}`),
  ].join('\n');
  return clampToMaxChars(out, maxChars);
}

function ultraMarkdown(text: string, maxChars: number): string {
  const lines = text.split('\n');
  const headings: string[] = [];
  const withLead = maxChars > 900;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (!/^#{1,6}\s/.test(line)) continue;
    headings.push(line.trim());
    if (withLead) {
      let j = i + 1;
      while (j < lines.length && !(lines[j] ?? '').trim()) j++;
      if (j < lines.length) headings.push((lines[j] ?? '').trim().slice(0, 90));
    }
    if (headings.length >= 60) break;
  }

  const out = headings.join('\n');
  if (out.trim()) return clampToMaxChars(out, maxChars);
  return ultraGeneric(text, maxChars);
}

function ultraCsv(text: string, maxChars: number): string {
  const lines = text.split('\n').filter(l => l.trim());
  if (lines.length === 0) return '';

  const delimiters = [',', '\t', ';', '|'];
  let delimiter = ',';
  for (const d of delimiters) {
    if ((lines[0] ?? '').includes(d)) {
      delimiter = d;
      break;
    }
  }

  const header = lines[0] ?? '';
  const cols = header
    .split(delimiter)
    .map(c => c.trim())
    .filter(Boolean);
  const rowCount = Math.max(0, lines.length - 1);
  const sample = lines[1] ?? '';

  const out = [
    `csv rows=${rowCount} cols=${cols.length}`,
    `c:${cols.slice(0, 12).join(',')}`,
    sample ? `s:${sample.slice(0, 140)}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  return clampToMaxChars(out, maxChars);
}

function ultraCode(text: string, maxChars: number): string {
  const lines = text.split('\n');
  const picks: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (
      /^(export\s+)?(async\s+)?function\s+\w+/.test(trimmed) ||
      /^(export\s+)?(abstract\s+)?class\s+\w+/.test(trimmed) ||
      /^(type|interface|enum)\s+\w+/.test(trimmed) ||
      /^(import|from)\s/.test(trimmed)
    ) {
      picks.push(trimmed.slice(0, 120));
    }
    if (picks.length >= 40) break;
  }

  const out = picks.join('\n');
  if (out.trim()) return clampToMaxChars(out, maxChars);
  return ultraGeneric(text, maxChars);
}

function ultraGeneric(text: string, maxChars: number): string {
  const lines = text.split('\n');
  if (lines.length <= 16) return clampToMaxChars(text, maxChars);

  const head = lines.slice(0, 10).join('\n');
  const tail = lines.slice(-4).join('\n');
  const omitted = lines.length - 14;
  const out = `${head}\n...\n[omit:${omitted}]\n...\n${tail}`;
  return clampToMaxChars(out, maxChars);
}

function genericTruncate(
  text: string,
  maxChars: number,
  headLines = 50,
  tailLines = 20,
  intent?: string
): string {
  if (intent) return filterByIntent(text, intent, maxChars);

  const lines = text.split('\n');
  const totalLines = lines.length;

  if (lines.length <= headLines + tailLines) {
    return clampToMaxChars(text, maxChars);
  }

  const head = lines.slice(0, headLines).join('\n');
  const tail = lines.slice(-tailLines).join('\n');
  const omitted = totalLines - headLines - tailLines;

  const omissionMarker = `... [${omitted} lines omitted] ...`;
  const candidate = `${head}\n\n${omissionMarker}\n\n${tail}`;
  if (candidate.length <= maxChars) return candidate;

  const available = maxChars - omissionMarker.length - 4; // separator newlines
  if (available <= 0) return clampToMaxChars(omissionMarker, maxChars);

  const headBudget = Math.ceil(available * 0.6);
  const tailBudget = Math.max(0, available - headBudget);
  const compactHead = clampToMaxChars(head, headBudget);
  const compactTail = tailBudget > 0 ? tail.slice(Math.max(0, tail.length - tailBudget)) : '';
  return clampToMaxChars(`${compactHead}\n\n${omissionMarker}\n\n${compactTail}`, maxChars);
}

// ─── Main compress function ───────────────────────────────────────────────────

export function compress(text: string, options: CompressOptions = {}): CompressResult {
  const maxOutputChars = resolveMaxOutputChars(options.maxOutputChars);
  const inputChars = text.length;
  const parsedJson = options.parsedJson ?? tryParseJson(text);
  const contentType = detectContentTypeWithParsed(text, parsedJson);
  let strategy: CompressionStrategy =
    options.strategy ?? DEFAULT_CONFIG.compression.defaultStrategy;
  let output: string;

  if (!options.strategy && options.intent) {
    strategy = 'filter';
  }

  if (strategy === 'auto') {
    // Pick best strategy based on content type
    if (options.intent) {
      strategy = 'filter';
    } else {
      strategy = 'ultra';
    }
  }

  switch (strategy) {
    case 'filter':
      output = filterByIntent(text, options.intent ?? '', maxOutputChars);
      break;
    case 'ultra':
      output = compressUltra(text, contentType, maxOutputChars, parsedJson);
      break;
    case 'truncate':
      output = genericTruncate(
        text,
        maxOutputChars,
        options.headLines ?? 50,
        options.tailLines ?? 20,
        options.intent
      );
      break;
    case 'summarize':
      switch (contentType) {
        case 'json':
          output = compressJson(text, maxOutputChars, options.intent, parsedJson);
          break;
        case 'log':
          output = compressLog(text, maxOutputChars, options.intent);
          break;
        case 'code':
          output = compressCode(text, maxOutputChars, options.intent);
          break;
        case 'markdown':
          output = compressMarkdown(text, maxOutputChars, options.intent);
          break;
        case 'csv':
          output = compressCsv(text, maxOutputChars, options.intent);
          break;
        case 'diff':
          output = compressDiff(text, maxOutputChars, options.intent);
          break;
        case 'stacktrace':
          output = compressStackTrace(text, maxOutputChars, options.intent);
          break;
        case 'env':
          output = compressEnv(text, maxOutputChars, options.intent);
          break;
        default:
          output = genericTruncate(text, maxOutputChars, 50, 20, options.intent);
      }
      break;
    default:
      output = text;
  }

  output = clampToMaxChars(output, maxOutputChars);

  const outputChars = output.length;
  const savedPercent =
    inputChars > 0 ? Math.round(((inputChars - outputChars) / inputChars) * 100) : 0;

  return { output, strategy, contentType, inputChars, outputChars, savedPercent };
}
