import { DEFAULT_CONFIG, type KansoConfig } from './defaults.js';

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

const LOG_LEVELS: ReadonlySet<KansoConfig['logging']['level']> = new Set([
  'debug',
  'info',
  'warn',
  'error',
]);
const SHELL_RUNTIMES: ReadonlySet<KansoConfig['sandbox']['shellDefault']> = new Set([
  'auto',
  'powershell',
  'cmd',
  'git-bash',
  'bash',
  'zsh',
  'sh',
]);
const RESPONSE_MODES: ReadonlySet<KansoConfig['compression']['responseMode']> = new Set([
  'minimal',
  'full',
]);
const TOKEN_PROFILES: ReadonlySet<KansoConfig['tokens']['profile']> = new Set([
  'auto',
  'openai_o200k',
  'openai_cl100k',
  'generic',
]);
const WEB_PROVIDERS: ReadonlySet<KansoConfig['web']['provider']> = new Set([
  'off',
  'brave_context',
  'firecrawl_search',
  'exa',
]);

function asObject(input: unknown): Record<string, unknown> | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return null;
  }
  return input as Record<string, unknown>;
}

function parsePositiveInt(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return parsed;
}

function parseBoolean(raw: string | undefined): boolean | undefined {
  if (!raw) return undefined;
  const normalized = raw.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return undefined;
}

export function parseConfig(input: unknown): KansoConfig {
  const partial = (asObject(input) ?? {}) as DeepPartial<KansoConfig>;

  return {
    compression: {
      ...DEFAULT_CONFIG.compression,
      ...(partial.compression ?? {}),
    },
    sandbox: {
      ...DEFAULT_CONFIG.sandbox,
      ...(partial.sandbox ?? {}),
    },
    security: {
      ...DEFAULT_CONFIG.security,
      ...(partial.security ?? {}),
    },
    storage: {
      ...DEFAULT_CONFIG.storage,
      ...(partial.storage ?? {}),
    },
    tokens: {
      ...DEFAULT_CONFIG.tokens,
      ...(partial.tokens ?? {}),
    },
    logging: {
      ...DEFAULT_CONFIG.logging,
      ...(partial.logging ?? {}),
    },
    stats: {
      ...DEFAULT_CONFIG.stats,
      ...(partial.stats ?? {}),
    },
    knowledgeBase: {
      ...DEFAULT_CONFIG.knowledgeBase,
      ...(partial.knowledgeBase ?? {}),
    },
    web: {
      ...DEFAULT_CONFIG.web,
      ...(partial.web ?? {}),
    },
  };
}

export function loadConfigFromEnv(): DeepPartial<KansoConfig> {
  const config: DeepPartial<KansoConfig> = {};

  const maxOutputBytes = parsePositiveInt(process.env['KCM_MAX_OUTPUT_BYTES']);
  if (maxOutputBytes !== undefined) {
    config.compression = config.compression ?? {};
    config.compression.maxOutputBytes = maxOutputBytes;
  }

  const defaultMaxOutputTokens = parsePositiveInt(process.env['KCM_DEFAULT_MAX_OUTPUT_TOKENS']);
  if (defaultMaxOutputTokens !== undefined) {
    config.compression = config.compression ?? {};
    config.compression.defaultMaxOutputTokens = defaultMaxOutputTokens;
  }

  const hardMaxOutputTokens = parsePositiveInt(process.env['KCM_HARD_MAX_OUTPUT_TOKENS']);
  if (hardMaxOutputTokens !== undefined) {
    config.compression = config.compression ?? {};
    config.compression.hardMaxOutputTokens = hardMaxOutputTokens;
  }

  const responseMode = process.env['KCM_RESPONSE_MODE'];
  if (
    responseMode &&
    RESPONSE_MODES.has(responseMode as KansoConfig['compression']['responseMode'])
  ) {
    config.compression = config.compression ?? {};
    config.compression.responseMode = responseMode as KansoConfig['compression']['responseMode'];
  }

  const timeoutMs = parsePositiveInt(process.env['KCM_TIMEOUT_MS']);
  if (timeoutMs !== undefined) {
    config.sandbox = config.sandbox ?? {};
    config.sandbox.timeoutMs = timeoutMs;
  }

  const memoryMB = parsePositiveInt(process.env['KCM_MEMORY_MB']);
  if (memoryMB !== undefined) {
    config.sandbox = config.sandbox ?? {};
    config.sandbox.memoryMB = memoryMB;
  }

  const maxFileBytes = parsePositiveInt(process.env['KCM_MAX_FILE_BYTES']);
  if (maxFileBytes !== undefined) {
    config.sandbox = config.sandbox ?? {};
    config.sandbox.maxFileBytes = maxFileBytes;
  }

  const allowAuthPassthrough = parseBoolean(process.env['KCM_ALLOW_AUTH_PASSTHROUGH']);
  if (allowAuthPassthrough !== undefined) {
    config.sandbox = config.sandbox ?? {};
    config.sandbox.allowAuthPassthrough = allowAuthPassthrough;
  }

  const shell = process.env['KCM_SHELL'];
  if (shell && SHELL_RUNTIMES.has(shell as KansoConfig['sandbox']['shellDefault'])) {
    config.sandbox = config.sandbox ?? {};
    config.sandbox.shellDefault = shell as KansoConfig['sandbox']['shellDefault'];
  }

  const policyMode = process.env['KCM_POLICY_MODE'];
  if (policyMode === 'strict' || policyMode === 'balanced' || policyMode === 'permissive') {
    config.security = config.security ?? {};
    config.security.policyMode = policyMode;
  }

  const allowPrivateNetworkFetch = parseBoolean(process.env['KCM_ALLOW_PRIVATE_NETWORK_FETCH']);
  if (allowPrivateNetworkFetch !== undefined) {
    config.security = config.security ?? {};
    config.security.allowPrivateNetworkFetch = allowPrivateNetworkFetch;
  }

  if (process.env['KCM_STATE_DIR']) {
    config.storage = config.storage ?? {};
    config.storage.stateDir = process.env['KCM_STATE_DIR'];
  }

  const handleTtlHours = parsePositiveInt(process.env['KCM_HANDLE_TTL_HOURS']);
  if (handleTtlHours !== undefined) {
    config.storage = config.storage ?? {};
    config.storage.handleTtlHours = handleTtlHours;
  }

  const hotCacheMB = parsePositiveInt(process.env['KCM_HOT_CACHE_MB']);
  if (hotCacheMB !== undefined) {
    config.storage = config.storage ?? {};
    config.storage.hotCacheMB = hotCacheMB;
  }

  const hotCacheEntries = parsePositiveInt(process.env['KCM_HOT_CACHE_ENTRIES']);
  if (hotCacheEntries !== undefined) {
    config.storage = config.storage ?? {};
    config.storage.hotCacheEntries = hotCacheEntries;
  }

  const hotCacheTtlMs = parsePositiveInt(process.env['KCM_HOT_CACHE_TTL_MS']);
  if (hotCacheTtlMs !== undefined) {
    config.storage = config.storage ?? {};
    config.storage.hotCacheTtlMs = hotCacheTtlMs;
  }

  const cleanupEveryWrites = parsePositiveInt(process.env['KCM_CLEANUP_EVERY_WRITES']);
  if (cleanupEveryWrites !== undefined) {
    config.storage = config.storage ?? {};
    config.storage.cleanupEveryWrites = cleanupEveryWrites;
  }

  const sessionMaxEvents = parsePositiveInt(process.env['KCM_SESSION_MAX_EVENTS']);
  if (sessionMaxEvents !== undefined) {
    config.storage = config.storage ?? {};
    config.storage.sessionMaxEvents = sessionMaxEvents;
  }

  const sessionSnapshotBytes = parsePositiveInt(process.env['KCM_SESSION_SNAPSHOT_BYTES']);
  if (sessionSnapshotBytes !== undefined) {
    config.storage = config.storage ?? {};
    config.storage.sessionSnapshotBytes = sessionSnapshotBytes;
  }

  const tokenProfile = process.env['KCM_TOKEN_PROFILE'];
  if (tokenProfile && TOKEN_PROFILES.has(tokenProfile as KansoConfig['tokens']['profile'])) {
    config.tokens = config.tokens ?? {};
    config.tokens.profile = tokenProfile as KansoConfig['tokens']['profile'];
  }

  const maxFetchBytes = parsePositiveInt(process.env['KCM_MAX_FETCH_BYTES']);
  if (maxFetchBytes !== undefined) {
    config.knowledgeBase = config.knowledgeBase ?? {};
    config.knowledgeBase.maxFetchBytes = maxFetchBytes;
  }

  const webProvider = process.env['KCM_WEB_SEARCH_PROVIDER'];
  if (webProvider && WEB_PROVIDERS.has(webProvider as KansoConfig['web']['provider'])) {
    config.web = config.web ?? {};
    config.web.provider = webProvider as KansoConfig['web']['provider'];
  }

  const webSearchTtlHours = parsePositiveInt(process.env['KCM_WEB_SEARCH_TTL_HOURS']);
  if (webSearchTtlHours !== undefined) {
    config.web = config.web ?? {};
    config.web.cacheTtlHours = webSearchTtlHours;
  }

  const webSearchMaxResults = parsePositiveInt(process.env['KCM_WEB_SEARCH_MAX_RESULTS']);
  if (webSearchMaxResults !== undefined) {
    config.web = config.web ?? {};
    config.web.maxResults = webSearchMaxResults;
  }

  if (process.env['KCM_BRAVE_API_KEY']) {
    config.web = config.web ?? {};
    config.web.braveApiKey = process.env['KCM_BRAVE_API_KEY'];
  }

  if (process.env['KCM_FIRECRAWL_API_KEY']) {
    config.web = config.web ?? {};
    config.web.firecrawlApiKey = process.env['KCM_FIRECRAWL_API_KEY'];
  }

  if (process.env['KCM_EXA_API_KEY']) {
    config.web = config.web ?? {};
    config.web.exaApiKey = process.env['KCM_EXA_API_KEY'];
  }

  if (process.env['KCM_STATS_EXPORT_PATH']) {
    config.stats = config.stats ?? {};
    config.stats.exportPath = process.env['KCM_STATS_EXPORT_PATH'];
  }

  const logLevel = process.env['LOG_LEVEL'] as KansoConfig['logging']['level'] | undefined;
  if (logLevel && LOG_LEVELS.has(logLevel)) {
    config.logging = { level: logLevel };
  }

  return config;
}
