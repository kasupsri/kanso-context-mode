import { DEFAULT_CONFIG, type ResponseMode } from '../config/defaults.js';
import { getAppState } from '../state/index.js';
import { contextResourceLink } from '../resources/registry.js';
import { asToolResult, type ToolExecutionResult } from './tool-result.js';
import { parsePositiveInteger } from './file-selectors.js';
import { searchWorkspace } from './workspace-helpers.js';
import { normalizeIncomingPath } from '../utils/path-input.js';

export interface WorkspaceSearchToolInput {
  query: string;
  root_path?: string;
  glob?: string;
  max_matches?: number;
  context_lines?: number;
  case_sensitive?: boolean;
  whole_word?: boolean;
  include_line_numbers?: boolean;
  return_context_id?: boolean;
  max_output_tokens?: number;
  response_mode?: ResponseMode;
}

export async function workspaceSearchTool(
  input: WorkspaceSearchToolInput
): Promise<ToolExecutionResult> {
  if (!input.query?.trim()) {
    return asToolResult('Error: workspace_search requires "query"');
  }

  const parsedMaxMatches = parsePositiveInteger(input.max_matches, 'workspace_search.max_matches');
  if (typeof parsedMaxMatches === 'string') return asToolResult(parsedMaxMatches);
  const parsedContextLines = parsePositiveInteger(
    input.context_lines,
    'workspace_search.context_lines'
  );
  if (typeof parsedContextLines === 'string') return asToolResult(parsedContextLines);

  const rootPath = normalizeIncomingPath(input.root_path ?? process.cwd());
  const results = await searchWorkspace({
    rootPath,
    query: input.query,
    glob: input.glob,
    maxMatches: parsedMaxMatches ?? 20,
    contextLines: parsedContextLines ?? 2,
    caseSensitive: input.case_sensitive ?? true,
    wholeWord: input.whole_word ?? false,
    includeLineNumbers: input.include_line_numbers ?? true,
  });
  const responseMode = input.response_mode ?? DEFAULT_CONFIG.compression.responseMode;
  const sourceText = results
    .map(result => `=== ${result.relativePath} ===\n${result.fullContent}`)
    .join('\n\n');

  const text =
    results.length === 0
      ? responseMode === 'minimal'
        ? `workspace_search none q="${input.query}"`
        : `No workspace matches found for "${input.query}".`
      : responseMode === 'minimal'
        ? [
            `workspace_search files=${results.length} q="${input.query}"`,
            ...results
              .slice(0, 8)
              .map(
                result =>
                  `${result.relativePath} matches=${result.totalMatches} lines=${result.matchedLines.slice(0, 4).join(',')}`
              ),
          ].join('\n')
        : [
            '=== Workspace Search ===',
            `root: ${rootPath}`,
            `query: ${input.query}`,
            `files: ${results.length}`,
            ...results.flatMap(result => [
              '',
              `### ${result.relativePath}`,
              `matches: ${result.totalMatches}`,
              result.text || '(no snippet)',
            ]),
          ].join('\n');

  const contextId =
    results.length > 0
      ? getAppState().saveHandle(text, `workspace_search:${input.query}`).id
      : undefined;
  const resourceLinks =
    contextId && (input.return_context_id ?? true)
      ? [contextResourceLink(contextId, `workspace_search:${input.query}`)]
      : [];

  return asToolResult(text, {
    sourceText,
    candidateText: text,
    comparisonBasis: 'workspace_source',
    resourceLinks,
  });
}
