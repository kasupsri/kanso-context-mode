import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../../../src/config/defaults.js';
import { loadConfigFromEnv, parseConfig } from '../../../src/config/schema.js';

const ENV_KEYS = [
  'KCM_TIMEOUT_MS',
  'KCM_MAX_FILE_BYTES',
  'KCM_HANDLE_TTL_HOURS',
  'KCM_HOT_CACHE_MB',
  'KCM_SESSION_MAX_EVENTS',
  'KCM_SESSION_SNAPSHOT_BYTES',
  'KCM_DEFAULT_MAX_OUTPUT_TOKENS',
  'KCM_HARD_MAX_OUTPUT_TOKENS',
  'KCM_RESPONSE_MODE',
  'KCM_POLICY_MODE',
  'KCM_TOKEN_PROFILE',
  'KCM_MAX_FETCH_BYTES',
  'KCM_STATE_DIR',
  'LOG_LEVEL',
] as const;

const originalEnv: Record<string, string | undefined> = Object.fromEntries(
  ENV_KEYS.map(key => [key, process.env[key]])
);

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('config schema', () => {
  it('parses validated KCM environment values', () => {
    process.env['KCM_TIMEOUT_MS'] = '45000';
    process.env['KCM_MAX_FILE_BYTES'] = '2048';
    process.env['KCM_HANDLE_TTL_HOURS'] = '12';
    process.env['KCM_HOT_CACHE_MB'] = '8';
    process.env['KCM_SESSION_MAX_EVENTS'] = '48';
    process.env['KCM_SESSION_SNAPSHOT_BYTES'] = '4096';
    process.env['KCM_DEFAULT_MAX_OUTPUT_TOKENS'] = '500';
    process.env['KCM_HARD_MAX_OUTPUT_TOKENS'] = '900';
    process.env['KCM_RESPONSE_MODE'] = 'full';
    process.env['KCM_POLICY_MODE'] = 'balanced';
    process.env['KCM_TOKEN_PROFILE'] = 'openai_cl100k';
    process.env['KCM_MAX_FETCH_BYTES'] = '8192';
    process.env['KCM_STATE_DIR'] = '/tmp/kcm-state';
    process.env['LOG_LEVEL'] = 'warn';

    const cfg = loadConfigFromEnv();

    expect(cfg.sandbox?.timeoutMs).toBe(45000);
    expect(cfg.sandbox?.maxFileBytes).toBe(2048);
    expect(cfg.storage?.handleTtlHours).toBe(12);
    expect(cfg.storage?.hotCacheMB).toBe(8);
    expect(cfg.storage?.sessionMaxEvents).toBe(48);
    expect(cfg.storage?.sessionSnapshotBytes).toBe(4096);
    expect(cfg.storage?.stateDir).toBe('/tmp/kcm-state');
    expect(cfg.compression?.defaultMaxOutputTokens).toBe(500);
    expect(cfg.compression?.hardMaxOutputTokens).toBe(900);
    expect(cfg.compression?.responseMode).toBe('full');
    expect(cfg.security?.policyMode).toBe('balanced');
    expect(cfg.tokens?.profile).toBe('openai_cl100k');
    expect(cfg.knowledgeBase?.maxFetchBytes).toBe(8192);
    expect(cfg.logging?.level).toBe('warn');
  });

  it('ignores invalid numeric and enum values', () => {
    process.env['KCM_TIMEOUT_MS'] = '-5';
    process.env['KCM_HOT_CACHE_MB'] = 'zero';
    process.env['KCM_SESSION_MAX_EVENTS'] = '0';
    process.env['KCM_POLICY_MODE'] = 'unsafe';
    process.env['KCM_TOKEN_PROFILE'] = 'claude';
    process.env['KCM_MAX_FETCH_BYTES'] = '0';

    const cfg = loadConfigFromEnv();

    expect(cfg.sandbox?.timeoutMs).toBeUndefined();
    expect(cfg.storage?.hotCacheMB).toBeUndefined();
    expect(cfg.storage?.sessionMaxEvents).toBeUndefined();
    expect(cfg.security?.policyMode).toBeUndefined();
    expect(cfg.tokens?.profile).toBeUndefined();
    expect(cfg.knowledgeBase?.maxFetchBytes).toBeUndefined();
  });

  it('returns a cloned default config for undefined input', () => {
    const parsed = parseConfig(undefined);
    const originalTimeout = DEFAULT_CONFIG.sandbox.timeoutMs;

    expect(parsed).toEqual(DEFAULT_CONFIG);
    parsed.sandbox.timeoutMs = originalTimeout + 1;
    expect(DEFAULT_CONFIG.sandbox.timeoutMs).toBe(originalTimeout);
  });
});
