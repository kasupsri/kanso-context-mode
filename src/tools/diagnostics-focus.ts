import { DEFAULT_CONFIG, type ResponseMode } from '../config/defaults.js';
import { parsePositiveInteger } from './file-selectors.js';

export interface DiagnosticsFocusToolInput {
  content: string;
  format?: 'auto' | 'tsc' | 'eslint' | 'vitest' | 'jest' | 'generic';
  max_items?: number;
  include_examples?: boolean;
  max_output_tokens?: number;
  response_mode?: ResponseMode;
}

interface DiagnosticIssue {
  severity: 'error' | 'warning' | 'info';
  file?: string;
  line?: number;
  column?: number;
  code?: string;
  message: string;
  count: number;
  sample: string;
}

const TSC_PATTERN = /^(.+?)\((\d+),(\d+)\):\s*(error|warning)\s*(TS\d+)?\s*:?\s*(.+?)\s*$/i;
const ESLINT_PATTERN = /^(.+?):(\d+):(\d+):\s*(error|warning)\s+(.+?)\s*$/i;
const FILE_PREFIX_PATTERN = /^((?:[A-Za-z]:)?[^:\s]+\.[A-Za-z0-9]+):\s*(.+)$/;

function severityRank(severity: DiagnosticIssue['severity']): number {
  if (severity === 'error') return 0;
  if (severity === 'warning') return 1;
  return 2;
}

function detectFormat(
  input: DiagnosticsFocusToolInput['format'],
  lines: string[]
): DiagnosticsFocusToolInput['format'] {
  if (input && input !== 'auto') return input;
  for (const line of lines) {
    if (TSC_PATTERN.test(line)) return 'tsc';
    if (ESLINT_PATTERN.test(line)) return 'eslint';
    if (/^\s*(FAIL|PASS)\s+/.test(line)) return 'vitest';
  }
  return 'generic';
}

function normalizeMessage(message: string): string {
  return message.trim().replace(/\s+/g, ' ');
}

function buildKey(issue: Omit<DiagnosticIssue, 'count' | 'sample'>): string {
  return [
    issue.severity,
    issue.file ?? '',
    issue.line ?? '',
    issue.column ?? '',
    issue.code ?? '',
    issue.message,
  ].join('|');
}

function pushIssue(
  map: Map<string, DiagnosticIssue>,
  issueBase: Omit<DiagnosticIssue, 'count' | 'sample'>,
  sample: string
): void {
  const key = buildKey(issueBase);
  const existing = map.get(key);
  if (existing) {
    existing.count += 1;
    return;
  }
  map.set(key, { ...issueBase, count: 1, sample: sample.trim() });
}

function parseLine(
  format: DiagnosticsFocusToolInput['format'],
  line: string
): Omit<DiagnosticIssue, 'count' | 'sample'> | undefined {
  const tsc = TSC_PATTERN.exec(line);
  if (format === 'tsc' && tsc) {
    return {
      severity: (tsc[4]?.toLowerCase() === 'warning' ? 'warning' : 'error') as
        | 'error'
        | 'warning'
        | 'info',
      file: tsc[1]?.trim(),
      line: Number.parseInt(tsc[2] ?? '0', 10) || undefined,
      column: Number.parseInt(tsc[3] ?? '0', 10) || undefined,
      code: tsc[5]?.trim() || undefined,
      message: normalizeMessage(tsc[6] ?? ''),
    };
  }

  const eslint = ESLINT_PATTERN.exec(line);
  if (format === 'eslint' && eslint) {
    return {
      severity: (eslint[4]?.toLowerCase() === 'warning' ? 'warning' : 'error') as
        | 'error'
        | 'warning'
        | 'info',
      file: eslint[1]?.trim(),
      line: Number.parseInt(eslint[2] ?? '0', 10) || undefined,
      column: Number.parseInt(eslint[3] ?? '0', 10) || undefined,
      message: normalizeMessage(eslint[5] ?? ''),
    };
  }

  if (format === 'vitest' || format === 'jest') {
    if (/^\s*(FAIL|PASS)\s+/.test(line)) {
      return {
        severity: 'info',
        message: normalizeMessage(line),
      };
    }
    const prefixed = FILE_PREFIX_PATTERN.exec(line);
    if (prefixed) {
      return {
        severity: /warning/i.test(prefixed[2] ?? '') ? 'warning' : 'error',
        file: prefixed[1]?.trim(),
        message: normalizeMessage(prefixed[2] ?? ''),
      };
    }
    if (/error|exception|failed/i.test(line)) {
      return {
        severity: 'error',
        message: normalizeMessage(line),
      };
    }
  }

  if (format === 'generic') {
    if (!line.trim()) return undefined;
    if (/error|exception|failed/i.test(line)) {
      return { severity: 'error', message: normalizeMessage(line) };
    }
    if (/warn/i.test(line)) {
      return { severity: 'warning', message: normalizeMessage(line) };
    }
  }

  return undefined;
}

export function diagnosticsFocusTool(input: DiagnosticsFocusToolInput): string {
  const responseMode = input.response_mode ?? DEFAULT_CONFIG.compression.responseMode;
  const parsedMaxItems = parsePositiveInteger(input.max_items, 'diagnostics_focus.max_items');
  if (typeof parsedMaxItems === 'string') return parsedMaxItems;
  const maxItems = parsedMaxItems ?? 30;
  const includeExamples = input.include_examples ?? true;

  const lines = input.content.replace(/\r\n/g, '\n').split('\n');
  const detectedFormat = detectFormat(input.format, lines);
  const issuesMap = new Map<string, DiagnosticIssue>();

  for (const line of lines) {
    const issue = parseLine(detectedFormat, line);
    if (!issue) continue;
    pushIssue(issuesMap, issue, line);
  }

  const issues = [...issuesMap.values()].sort((a, b) => {
    if (severityRank(a.severity) !== severityRank(b.severity)) {
      return severityRank(a.severity) - severityRank(b.severity);
    }
    if (a.count !== b.count) return b.count - a.count;
    const af = a.file ?? '';
    const bf = b.file ?? '';
    return af.localeCompare(bf);
  });

  const shown = issues.slice(0, maxItems);
  const errors = issues.filter(i => i.severity === 'error').length;
  const warnings = issues.filter(i => i.severity === 'warning').length;

  if (responseMode === 'minimal') {
    return [
      'ok:diagnostics_focus',
      `format=${detectedFormat}`,
      `issues=${issues.length}`,
      `errors=${errors}`,
      `warnings=${warnings}`,
      `shown=${shown.length}`,
    ].join(' ');
  }

  const out = shown.map(issue => {
    const loc =
      issue.file && issue.line
        ? `${issue.file}:${issue.line}${issue.column ? `:${issue.column}` : ''}`
        : (issue.file ?? 'n/a');
    const code = issue.code ? `${issue.code} ` : '';
    const repeat = issue.count > 1 ? ` x${issue.count}` : '';
    const base = `- ${issue.severity.toUpperCase()} ${loc} ${code}${issue.message}${repeat}`.trim();
    if (!includeExamples) return base;
    return `${base}\n  sample: ${issue.sample}`;
  });

  return [
    '=== Diagnostics Focus ===',
    `format: ${detectedFormat}`,
    `input_lines: ${lines.length}`,
    `issues: ${issues.length}`,
    `errors: ${errors}`,
    `warnings: ${warnings}`,
    `showing: ${shown.length}`,
    out.join('\n'),
  ].join('\n');
}
