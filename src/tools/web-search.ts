import { createHash } from 'crypto';
import { DEFAULT_CONFIG, type ResponseMode, type WebSearchProvider } from '../config/defaults.js';
import { contextResourceLink } from '../resources/registry.js';
import { getAppState } from '../state/index.js';
import { asToolResult, type ToolExecutionResult } from './tool-result.js';
import { availableWebProviders, resolveWebProvider } from '../web/providers.js';

export interface WebSearchToolInput {
  query: string;
  domains?: string[];
  result_limit?: number;
  recency_days?: number;
  kind?: 'general' | 'docs' | 'code' | 'news';
  provider?: WebSearchProvider;
  max_output_tokens?: number;
  response_mode?: ResponseMode;
}

function asPositiveInt(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined;
  return Math.floor(value);
}

function buildQueryKey(input: WebSearchToolInput): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        query: input.query.trim(),
        domains: [...(input.domains ?? [])].sort(),
        resultLimit: input.result_limit ?? DEFAULT_CONFIG.web.maxResults,
        recencyDays: input.recency_days ?? null,
        kind: input.kind ?? 'general',
        provider: input.provider ?? DEFAULT_CONFIG.web.provider,
      }),
      'utf8'
    )
    .digest('hex');
}

export async function webSearchTool(input: WebSearchToolInput): Promise<ToolExecutionResult> {
  if (!input.query?.trim()) {
    return asToolResult('Error: web_search requires "query"');
  }

  const state = getAppState();
  const queryKey = buildQueryKey(input);
  const requestedProvider = input.provider ?? DEFAULT_CONFIG.web.provider;
  const provider = resolveWebProvider(requestedProvider);
  const cached = state.getWebSearchCache(provider.id, queryKey);

  const response = cached
    ? {
        provider: provider.id,
        capabilities: provider.capabilities,
        query: input.query.trim(),
        results: JSON.parse(cached.responseJson) as Array<{
          url: string;
          title: string;
          snippet: string;
          sourceText: string;
          score?: number;
          publishedAt?: string;
        }>,
        sourceText: cached.sourceText,
        raw: cached.responseJson,
      }
    : await provider.search({
        query: input.query.trim(),
        domains: input.domains,
        resultLimit: asPositiveInt(input.result_limit) ?? DEFAULT_CONFIG.web.maxResults,
        recencyDays: asPositiveInt(input.recency_days),
        kind: input.kind ?? 'general',
      });

  if (!cached) {
    state.putWebSearchCache({
      provider: response.provider,
      queryKey,
      queryText: input.query.trim(),
      resultCount: response.results.length,
      responseJson: JSON.stringify(response.results),
      sourceText: response.sourceText,
    });
  }

  const responseMode = input.response_mode ?? DEFAULT_CONFIG.compression.responseMode;
  const summaryText =
    response.results.length === 0
      ? responseMode === 'minimal'
        ? `web_search none provider=${response.provider} q="${input.query.trim()}"`
        : `No web results found for "${input.query.trim()}".`
      : responseMode === 'minimal'
        ? [
            `web_search provider=${response.provider} results=${response.results.length} cache=${cached ? 'hit' : 'miss'} q="${input.query.trim()}"`,
            ...response.results.map(result => `${result.title} :: ${result.url}`),
          ].join('\n')
        : [
            '=== Web Search ===',
            `provider: ${response.provider}`,
            `query: ${input.query.trim()}`,
            `results: ${response.results.length}`,
            `cache: ${cached ? 'hit' : 'miss'}`,
            `capabilities: ${Object.entries(response.capabilities)
              .filter(([, enabled]) => enabled)
              .map(([name]) => name)
              .join(', ')}`,
            ...response.results.flatMap((result, index) => [
              '',
              `### Result ${index + 1}`,
              `title: ${result.title}`,
              `url: ${result.url}`,
              result.publishedAt ? `published_at: ${result.publishedAt}` : '',
              result.score !== undefined ? `score: ${result.score}` : '',
              result.snippet || '(no snippet)',
            ]),
          ]
            .filter(Boolean)
            .join('\n');

  const contextId =
    response.results.length > 0
      ? state.saveHandle(
          response.sourceText,
          `web_search:${response.provider}:${input.query.trim()}`
        ).id
      : undefined;
  const resourceLinks = contextId
    ? [contextResourceLink(contextId, `web_search:${response.provider}:${input.query.trim()}`)]
    : [];

  return asToolResult(summaryText, {
    sourceText: response.sourceText,
    candidateText: summaryText,
    comparisonBasis: 'web_search_source',
    resourceLinks,
    sessionEvents: [
      {
        type: 'web_lookup',
        category: 'web',
        priority: 1,
        data: `${response.provider}:${input.query.trim()}`,
      },
    ],
  });
}

export function webProviderChoices(): string[] {
  return availableWebProviders();
}
