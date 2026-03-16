import { DEFAULT_CONFIG, type WebSearchProvider } from '../config/defaults.js';

export interface WebProviderCapabilities {
  results: boolean;
  context: boolean;
  scrape: boolean;
  similar: boolean;
}

export interface WebSearchRequest {
  query: string;
  domains?: string[];
  resultLimit?: number;
  recencyDays?: number;
  kind?: 'general' | 'docs' | 'code' | 'news';
}

export interface WebSearchNormalizedResult {
  url: string;
  title: string;
  snippet: string;
  sourceText: string;
  score?: number;
  publishedAt?: string;
}

export interface WebSearchResponse {
  provider: WebSearchProvider;
  capabilities: WebProviderCapabilities;
  query: string;
  results: WebSearchNormalizedResult[];
  sourceText: string;
  raw: unknown;
}

interface WebSearchProviderClient {
  id: Exclude<WebSearchProvider, 'off'>;
  capabilities: WebProviderCapabilities;
  isConfigured(): boolean;
  search(input: WebSearchRequest): Promise<WebSearchResponse>;
}

const PROVIDER_CAPABILITIES: Record<Exclude<WebSearchProvider, 'off'>, WebProviderCapabilities> = {
  brave_context: {
    results: true,
    context: true,
    scrape: false,
    similar: false,
  },
  firecrawl_search: {
    results: true,
    context: true,
    scrape: true,
    similar: false,
  },
  exa: {
    results: true,
    context: true,
    scrape: false,
    similar: true,
  },
};

function withDomainFilters(query: string, domains?: string[]): string {
  if (!domains || domains.length === 0) return query;
  const filters = domains
    .map(domain => domain.trim())
    .filter(Boolean)
    .map(domain => `site:${domain}`);
  return `${query} ${filters.join(' OR ')}`.trim();
}

function normalizeSnippet(value: unknown, maxChars = 400): string {
  if (typeof value === 'string') return value.replace(/\s+/g, ' ').trim().slice(0, maxChars);
  if (Array.isArray(value)) {
    return value
      .map(item => normalizeSnippet(item, maxChars))
      .filter(Boolean)
      .join(' ')
      .slice(0, maxChars);
  }
  return '';
}

function aggregateSourceText(
  result: WebSearchNormalizedResult[],
  provider: string,
  query: string
): string {
  return [
    `provider: ${provider}`,
    `query: ${query}`,
    ...result.map(
      (item, index) =>
        `\n[${index + 1}] ${item.title}\nurl: ${item.url}\n${item.sourceText || item.snippet || '(no content)'}`
    ),
  ].join('\n');
}

function objectArray(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object'
  );
}

function normalizeResult(raw: Record<string, unknown>): WebSearchNormalizedResult | null {
  const url =
    (typeof raw['url'] === 'string' && raw['url']) ||
    (typeof raw['link'] === 'string' && raw['link']) ||
    (typeof raw['source'] === 'string' && raw['source']) ||
    '';
  if (!url) return null;

  const title =
    (typeof raw['title'] === 'string' && raw['title']) ||
    (typeof raw['name'] === 'string' && raw['name']) ||
    url;
  const snippet =
    normalizeSnippet(raw['description']) ||
    normalizeSnippet(raw['snippet']) ||
    normalizeSnippet(raw['summary']) ||
    normalizeSnippet(raw['text']) ||
    normalizeSnippet(raw['highlights']);
  const sourceText =
    normalizeSnippet(raw['text'], 2_000) ||
    normalizeSnippet(raw['content'], 2_000) ||
    normalizeSnippet(raw['highlights'], 2_000) ||
    snippet;
  const score =
    typeof raw['score'] === 'number'
      ? raw['score']
      : typeof raw['relevance'] === 'number'
        ? raw['relevance']
        : undefined;
  const publishedAt =
    (typeof raw['publishedDate'] === 'string' && raw['publishedDate']) ||
    (typeof raw['published_at'] === 'string' && raw['published_at']) ||
    (typeof raw['page_age'] === 'string' && raw['page_age']) ||
    undefined;

  return {
    url,
    title,
    snippet,
    sourceText,
    score,
    publishedAt,
  };
}

function filterByRecency(
  results: WebSearchNormalizedResult[],
  recencyDays?: number
): WebSearchNormalizedResult[] {
  if (!recencyDays || recencyDays <= 0) return results;
  const cutoff = Date.now() - recencyDays * 24 * 60 * 60 * 1000;
  const filtered = results.filter(result => {
    if (!result.publishedAt) return true;
    const parsed = Date.parse(result.publishedAt);
    if (!Number.isFinite(parsed)) return true;
    return parsed >= cutoff;
  });
  return filtered.length > 0 ? filtered : results;
}

async function postJson(
  url: string,
  body: Record<string, unknown>,
  headers: Record<string, string>
): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }

  return (await response.json()) as Record<string, unknown>;
}

const braveProvider: WebSearchProviderClient = {
  id: 'brave_context',
  capabilities: PROVIDER_CAPABILITIES.brave_context,
  isConfigured(): boolean {
    return Boolean(DEFAULT_CONFIG.web.braveApiKey?.trim());
  },
  async search(input: WebSearchRequest): Promise<WebSearchResponse> {
    if (!DEFAULT_CONFIG.web.braveApiKey) {
      throw new Error('Brave Search API key is not configured.');
    }

    const query = withDomainFilters(input.query, input.domains);
    const payload: Record<string, unknown> = {
      q: query,
      count: Math.max(1, Math.min(input.resultLimit ?? DEFAULT_CONFIG.web.maxResults, 10)),
      max_results: Math.max(1, Math.min(input.resultLimit ?? DEFAULT_CONFIG.web.maxResults, 10)),
      threshold_mode: input.kind === 'docs' || input.kind === 'code' ? 'strict' : 'balanced',
      max_chars_per_result: 2_000,
      max_total_chars: 8_000,
    };
    if (input.kind === 'news') {
      payload['freshness'] = 'pd';
    }

    const raw = await postJson('https://api.search.brave.com/res/v1/llm/context', payload, {
      'X-Subscription-Token': DEFAULT_CONFIG.web.braveApiKey,
      'Accept-Encoding': 'gzip',
    });

    const rawResults = [
      ...objectArray(raw['generic']),
      ...objectArray(raw['results']),
      ...objectArray(raw['web']),
    ];
    const results = filterByRecency(
      rawResults
        .map(item => normalizeResult(item))
        .filter((item): item is WebSearchNormalizedResult => Boolean(item))
        .slice(0, input.resultLimit ?? DEFAULT_CONFIG.web.maxResults),
      input.recencyDays
    );

    return {
      provider: 'brave_context',
      capabilities: braveProvider.capabilities,
      query,
      results,
      sourceText: aggregateSourceText(results, 'brave_context', query),
      raw,
    };
  },
};

const firecrawlProvider: WebSearchProviderClient = {
  id: 'firecrawl_search',
  capabilities: PROVIDER_CAPABILITIES.firecrawl_search,
  isConfigured(): boolean {
    return Boolean(DEFAULT_CONFIG.web.firecrawlApiKey?.trim());
  },
  async search(input: WebSearchRequest): Promise<WebSearchResponse> {
    if (!DEFAULT_CONFIG.web.firecrawlApiKey) {
      throw new Error('Firecrawl API key is not configured.');
    }

    const query = withDomainFilters(input.query, input.domains);
    const raw = await postJson(
      'https://api.firecrawl.dev/v2/search',
      {
        query,
        limit: Math.max(1, Math.min(input.resultLimit ?? DEFAULT_CONFIG.web.maxResults, 10)),
        scrapeOptions: { formats: ['markdown'] },
      },
      {
        Authorization: `Bearer ${DEFAULT_CONFIG.web.firecrawlApiKey}`,
      }
    );

    const data = raw['data'];
    const rawData = Array.isArray(data)
      ? objectArray(data)
      : objectArray((data as Record<string, unknown> | undefined)?.['web']);
    const results = filterByRecency(
      rawData
        .map(item => normalizeResult(item))
        .filter((item): item is WebSearchNormalizedResult => Boolean(item))
        .slice(0, input.resultLimit ?? DEFAULT_CONFIG.web.maxResults),
      input.recencyDays
    );

    return {
      provider: 'firecrawl_search',
      capabilities: firecrawlProvider.capabilities,
      query,
      results,
      sourceText: aggregateSourceText(results, 'firecrawl_search', query),
      raw,
    };
  },
};

const exaProvider: WebSearchProviderClient = {
  id: 'exa',
  capabilities: PROVIDER_CAPABILITIES.exa,
  isConfigured(): boolean {
    return Boolean(DEFAULT_CONFIG.web.exaApiKey?.trim());
  },
  async search(input: WebSearchRequest): Promise<WebSearchResponse> {
    if (!DEFAULT_CONFIG.web.exaApiKey) {
      throw new Error('Exa API key is not configured.');
    }

    const query = withDomainFilters(input.query, input.domains);
    const raw = await postJson(
      'https://api.exa.ai/search',
      {
        query,
        numResults: Math.max(1, Math.min(input.resultLimit ?? DEFAULT_CONFIG.web.maxResults, 10)),
        contents: {
          text: {
            maxCharacters: 2_000,
          },
          highlights: {
            numSentences: 4,
          },
        },
      },
      {
        'x-api-key': DEFAULT_CONFIG.web.exaApiKey,
      }
    );

    const rawResults = objectArray(raw['results']);
    const results = filterByRecency(
      rawResults
        .map(item => normalizeResult(item))
        .filter((item): item is WebSearchNormalizedResult => Boolean(item))
        .slice(0, input.resultLimit ?? DEFAULT_CONFIG.web.maxResults),
      input.recencyDays
    );

    return {
      provider: 'exa',
      capabilities: exaProvider.capabilities,
      query,
      results,
      sourceText: aggregateSourceText(results, 'exa', query),
      raw,
    };
  },
};

const PROVIDERS: Record<Exclude<WebSearchProvider, 'off'>, WebSearchProviderClient> = {
  brave_context: braveProvider,
  firecrawl_search: firecrawlProvider,
  exa: exaProvider,
};

export function resolveWebProvider(provider?: WebSearchProvider): WebSearchProviderClient {
  const id = provider && provider !== 'off' ? provider : DEFAULT_CONFIG.web.provider;
  if (id === 'off') {
    throw new Error('Web search provider is disabled. Configure KCM_WEB_SEARCH_PROVIDER first.');
  }
  const resolved = PROVIDERS[id];
  if (!resolved) {
    throw new Error(`Unsupported web search provider "${id}"`);
  }
  if (!resolved.isConfigured()) {
    throw new Error(`Web search provider "${id}" is not configured.`);
  }
  return resolved;
}

export function availableWebProviders(): Array<Exclude<WebSearchProvider, 'off'>> {
  return Object.keys(PROVIDERS) as Array<Exclude<WebSearchProvider, 'off'>>;
}
