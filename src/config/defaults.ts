import envPaths from 'env-paths';

export type ResponseMode = 'minimal' | 'full';
export type TokenProfile = 'auto' | 'openai_o200k' | 'openai_cl100k' | 'generic';

export interface KansoConfig {
  compression: {
    maxOutputBytes: number;
    defaultStrategy: 'auto' | 'truncate' | 'summarize' | 'filter' | 'ultra';
    headLines: number;
    tailLines: number;
    defaultMaxOutputTokens: number;
    hardMaxOutputTokens: number;
    responseMode: ResponseMode;
  };
  sandbox: {
    timeoutMs: number;
    memoryMB: number;
    preferBun: boolean;
    shellDefault: 'auto' | 'powershell' | 'cmd' | 'git-bash' | 'bash' | 'zsh' | 'sh';
    allowAuthPassthrough: boolean;
    maxFileBytes: number;
  };
  security: {
    policyMode: 'strict' | 'balanced' | 'permissive';
    allowPrivateNetworkFetch: boolean;
  };
  storage: {
    stateDir: string;
    handleTtlHours: number;
    hotCacheMB: number;
    hotCacheEntries: number;
    hotCacheTtlMs: number;
    eventRetentionDays: number;
    cleanupEveryWrites: number;
    sessionMaxEvents: number;
    sessionSnapshotBytes: number;
  };
  tokens: {
    profile: TokenProfile;
  };
  logging: {
    level: 'debug' | 'info' | 'warn' | 'error';
  };
  stats: {
    exportPath?: string;
  };
  knowledgeBase: {
    dbPath: string;
    maxChunkSize: number;
    chunkOverlap: number;
    searchTopK: number;
    maxFetchBytes: number;
  };
}

const paths = envPaths('kanso-context-mode', { suffix: '' });

export const DEFAULT_CONFIG: KansoConfig = {
  compression: {
    maxOutputBytes: 8 * 1024,
    defaultStrategy: 'ultra',
    headLines: 50,
    tailLines: 20,
    defaultMaxOutputTokens: 400,
    hardMaxOutputTokens: 800,
    responseMode: 'minimal',
  },
  sandbox: {
    timeoutMs: 30_000,
    memoryMB: 256,
    preferBun: true,
    shellDefault: 'auto',
    allowAuthPassthrough: false,
    maxFileBytes: 1 * 1024 * 1024,
  },
  security: {
    policyMode: 'strict',
    allowPrivateNetworkFetch: false,
  },
  storage: {
    stateDir: paths.data,
    handleTtlHours: 24,
    hotCacheMB: 4,
    hotCacheEntries: 32,
    hotCacheTtlMs: 5 * 60 * 1000,
    eventRetentionDays: 30,
    cleanupEveryWrites: 25,
    sessionMaxEvents: 100,
    sessionSnapshotBytes: 2048,
  },
  tokens: {
    profile: 'auto',
  },
  logging: {
    level: 'info',
  },
  stats: {},
  knowledgeBase: {
    dbPath: '',
    maxChunkSize: 1500,
    chunkOverlap: 100,
    searchTopK: 3,
    maxFetchBytes: 1_048_576,
  },
};
