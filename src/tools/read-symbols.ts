import { readFile, stat } from 'fs/promises';
import { DEFAULT_CONFIG, type ResponseMode } from '../config/defaults.js';
import { evaluateFilePath } from '../security/policy.js';

export interface ReadSymbolsToolInput {
  path: string;
  query?: string;
  kind?:
    | 'all'
    | 'function'
    | 'class'
    | 'interface'
    | 'type'
    | 'enum'
    | 'const'
    | 'method'
    | 'struct'
    | 'trait';
  max_symbols?: number;
  include_line_numbers?: boolean;
  max_output_tokens?: number;
  response_mode?: ResponseMode;
}

interface SymbolMatch {
  kind: string;
  name: string;
  line: number;
  signature: string;
}

interface SymbolPattern {
  kind: SymbolMatch['kind'];
  regex: RegExp;
}

const PATTERNS: SymbolPattern[] = [
  { kind: 'function', regex: /^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/ },
  {
    kind: 'const',
    regex:
      /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/,
  },
  { kind: 'class', regex: /^\s*(?:export\s+)?class\s+([A-Za-z_$][\w$]*)\b/ },
  { kind: 'interface', regex: /^\s*(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)\b/ },
  { kind: 'type', regex: /^\s*(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*=/ },
  { kind: 'enum', regex: /^\s*(?:export\s+)?enum\s+([A-Za-z_$][\w$]*)\b/ },
  { kind: 'class', regex: /^\s*class\s+([A-Za-z_$][\w$]*)\b/ },
  { kind: 'function', regex: /^\s*def\s+([A-Za-z_][\w]*)\s*\(/ },
  { kind: 'class', regex: /^\s*class\s+([A-Za-z_][\w]*)\s*(?:\(|:)/ },
  { kind: 'function', regex: /^\s*func\s+([A-Za-z_][\w]*)\s*\(/ },
  { kind: 'method', regex: /^\s*func\s*\([^)]*\)\s*([A-Za-z_][\w]*)\s*\(/ },
  { kind: 'struct', regex: /^\s*type\s+([A-Za-z_][\w]*)\s+struct\b/ },
  { kind: 'interface', regex: /^\s*type\s+([A-Za-z_][\w]*)\s+interface\b/ },
  { kind: 'function', regex: /^\s*(?:pub\s+)?fn\s+([A-Za-z_][\w]*)\s*\(/ },
  { kind: 'struct', regex: /^\s*(?:pub\s+)?struct\s+([A-Za-z_][\w]*)\b/ },
  { kind: 'enum', regex: /^\s*(?:pub\s+)?enum\s+([A-Za-z_][\w]*)\b/ },
  { kind: 'trait', regex: /^\s*(?:pub\s+)?trait\s+([A-Za-z_][\w]*)\b/ },
];

function normalizeSignature(line: string): string {
  return line.trim().replace(/\s+/g, ' ').slice(0, 160);
}

function extractSymbols(content: string): SymbolMatch[] {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const matches: SymbolMatch[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    for (const pattern of PATTERNS) {
      const match = pattern.regex.exec(line);
      if (!match) continue;
      const name = match[1] ?? '';
      if (!name) continue;
      const key = `${pattern.kind}:${name}:${i + 1}`;
      if (seen.has(key)) continue;
      seen.add(key);
      matches.push({
        kind: pattern.kind,
        name,
        line: i + 1,
        signature: normalizeSignature(line),
      });
      break;
    }
  }

  return matches;
}

function filterSymbols(
  symbols: SymbolMatch[],
  query?: string,
  kind: ReadSymbolsToolInput['kind'] = 'all'
): SymbolMatch[] {
  const queryNorm = query?.trim().toLowerCase();
  return symbols.filter(symbol => {
    if (kind && kind !== 'all' && symbol.kind !== kind) return false;
    if (!queryNorm) return true;
    const hay = `${symbol.name} ${symbol.signature}`.toLowerCase();
    return hay.includes(queryNorm);
  });
}

export async function readSymbolsTool(input: ReadSymbolsToolInput): Promise<string> {
  if (!input.path?.trim()) {
    return 'Error: read_symbols requires "path"';
  }

  const denied = evaluateFilePath(input.path);
  if (denied.denied) {
    return `Blocked by security policy: file path matches "${denied.matchedPattern}"`;
  }

  let fileStats;
  try {
    fileStats = await stat(input.path);
  } catch (err) {
    return `Error reading file "${input.path}": ${String(err)}`;
  }

  if (!fileStats.isFile()) {
    return `Error reading file "${input.path}": path is not a regular file`;
  }

  if (fileStats.size > DEFAULT_CONFIG.sandbox.maxFileBytes) {
    return [
      `Error reading file "${input.path}": file is too large for read_symbols.`,
      `Size: ${fileStats.size} bytes, limit: ${DEFAULT_CONFIG.sandbox.maxFileBytes} bytes.`,
    ].join('\n');
  }

  let content: string;
  try {
    content = await readFile(input.path, 'utf8');
  } catch (err) {
    return `Error reading file "${input.path}": ${String(err)}`;
  }

  const maxSymbols =
    typeof input.max_symbols === 'number' &&
    Number.isFinite(input.max_symbols) &&
    input.max_symbols > 0
      ? Math.floor(input.max_symbols)
      : 200;
  const includeLineNumbers = input.include_line_numbers ?? true;
  const responseMode = input.response_mode ?? DEFAULT_CONFIG.compression.responseMode;

  const allSymbols = extractSymbols(content);
  const filtered = filterSymbols(allSymbols, input.query, input.kind ?? 'all');
  const shown = filtered.slice(0, maxSymbols);

  if (responseMode === 'minimal') {
    const compact = shown
      .slice(0, 12)
      .map(s => `${s.kind}:${s.name}@${s.line}`)
      .join(',');
    return `ok:symbols path=${input.path} total=${filtered.length} shown=${shown.length} list=${compact}`;
  }

  const width = String(Math.max(1, ...shown.map(s => s.line))).length;
  const lines = shown.map(symbol => {
    const prefix = includeLineNumbers ? `${String(symbol.line).padStart(width, ' ')}| ` : '';
    return `${prefix}${symbol.kind} ${symbol.name} :: ${symbol.signature}`;
  });

  return [
    '=== Read Symbols ===',
    `path: ${input.path}`,
    `total: ${filtered.length}`,
    `showing: ${shown.length}`,
    input.query ? `query: ${input.query}` : '',
    input.kind && input.kind !== 'all' ? `kind: ${input.kind}` : '',
    lines.join('\n') || '(no symbols)',
  ]
    .filter(Boolean)
    .join('\n');
}
