import { DEFAULT_CONFIG } from '../config/defaults.js';
import { type ResponseMode } from '../config/defaults.js';
import { contextResourceLink, kbResourceLink } from '../resources/registry.js';
import { getAppState } from '../state/index.js';
import { asToolResult, type ToolExecutionResult } from './tool-result.js';

export interface SearchToolInput {
  query: string;
  kb_name?: string;
  top_k?: number;
  compact?: boolean;
  max_output_tokens?: number;
  response_mode?: ResponseMode;
}

export async function searchTool(input: SearchToolInput): Promise<ToolExecutionResult> {
  const topK =
    typeof input.top_k === 'number' && Number.isFinite(input.top_k) && input.top_k > 0
      ? Math.floor(input.top_k)
      : DEFAULT_CONFIG.knowledgeBase.searchTopK;
  const kbName = input.kb_name ?? 'default';
  const results = getAppState().searchKnowledge(input.query, kbName, topK);

  const responseMode = input.response_mode ?? DEFAULT_CONFIG.compression.responseMode;
  const compactByBudget =
    typeof input.max_output_tokens === 'number' &&
    Number.isFinite(input.max_output_tokens) &&
    input.max_output_tokens > 0 &&
    input.max_output_tokens <= 500;
  const compact = input.compact ?? (responseMode === 'minimal' || compactByBudget);

  const text =
    results.length === 0
      ? compact
        ? `search none q="${input.query}" kb=${kbName}`
        : `No results found for "${input.query}" in knowledge base "${kbName}".`
      : compact
        ? [
            `search n=${results.length} q="${input.query}" kb=${kbName}`,
            ...results.map(
              (result, index) =>
                `${index + 1}. s=${result.score.toFixed(2)} src=${result.source}${result.heading ? ` h=${result.heading}` : ''}\n${result.snippet.slice(0, 160)}`
            ),
          ].join('\n')
        : [
            `=== Knowledge Search ===`,
            `query: ${input.query}`,
            `kb: ${kbName}`,
            `results: ${results.length}`,
            ...results.flatMap((result, index) => [
              '',
              `### Result ${index + 1} (${result.score.toFixed(3)})`,
              `source: ${result.source}`,
              result.heading ? `heading: ${result.heading}` : '',
              result.content,
            ]),
          ]
            .filter(Boolean)
            .join('\n');

  const corpusStats = getAppState().getKnowledgeStats(kbName);
  const candidateSource = results.map(result => result.content).join('\n\n');
  const sourceText =
    corpusStats.sourceTokens > 0
      ? `kb=${kbName}\nbytes=${corpusStats.sourceBytes}\ntokens=${corpusStats.sourceTokens}`
      : candidateSource;
  const contextId =
    candidateSource.trim().length > 0
      ? getAppState().saveHandle(candidateSource, `kb_search:${kbName}:${input.query}`).id
      : undefined;

  return asToolResult(text, {
    sourceText,
    candidateText: candidateSource || text,
    comparisonBasis: 'indexed_source',
    resourceLinks: [
      kbResourceLink(kbName),
      ...(contextId ? [contextResourceLink(contextId, `kb_search:${kbName}:${input.query}`)] : []),
    ],
  });
}
