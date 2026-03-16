import { DEFAULT_CONFIG, type ResponseMode } from '../config/defaults.js';
import { contextResourceLink } from '../resources/registry.js';
import { asToolResult, type ToolExecutionResult } from './tool-result.js';
import { parsePositiveInteger, selectByQuery } from './file-selectors.js';
import { loadPathOrHandle } from './source-loader.js';

export interface ReadReferencesToolInput {
  path?: string;
  context_id?: string;
  symbol: string;
  context_lines?: number;
  max_matches?: number;
  include_line_numbers?: boolean;
  case_sensitive?: boolean;
  whole_word?: boolean;
  max_output_tokens?: number;
  response_mode?: ResponseMode;
}

export async function readReferencesTool(
  input: ReadReferencesToolInput
): Promise<ToolExecutionResult | string> {
  if (!input.symbol?.trim()) {
    return 'Error: read_references requires "symbol"';
  }

  const parsedContextLines = parsePositiveInteger(
    input.context_lines,
    'read_references.context_lines'
  );
  if (typeof parsedContextLines === 'string') return parsedContextLines;
  const parsedMaxMatches = parsePositiveInteger(input.max_matches, 'read_references.max_matches');
  if (typeof parsedMaxMatches === 'string') return parsedMaxMatches;

  const loaded = await loadPathOrHandle(input, 'read_references');
  if (typeof loaded === 'string') return loaded;

  const responseMode = input.response_mode ?? DEFAULT_CONFIG.compression.responseMode;
  const includeLineNumbers = input.include_line_numbers ?? true;
  const selected = selectByQuery(loaded.content, input.symbol, {
    contextLines: parsedContextLines ?? 2,
    maxMatches: parsedMaxMatches ?? 20,
    includeLineNumbers,
    caseSensitive: input.case_sensitive ?? true,
    wholeWord: input.whole_word ?? true,
  });

  const lines = [
    '=== Read References ===',
    `symbol: ${input.symbol}`,
    `source: ${loaded.sourceLabel}`,
    `matches: ${selected.totalMatches}`,
    `showing: ${selected.shownMatches}`,
    `context_id: ${loaded.contextId}`,
  ];
  if (loaded.fromHandle && responseMode === 'full') lines.push('handle: hit');
  lines.push(selected.text || '(no matches)');
  return asToolResult(lines.join('\n'), {
    sourceText: loaded.content,
    candidateText: selected.text || lines.join('\n'),
    comparisonBasis: 'full_file',
    resourceLinks: [contextResourceLink(loaded.contextId, loaded.sourceLabel)],
  });
}
