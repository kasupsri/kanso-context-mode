import { DEFAULT_CONFIG, type ResponseMode } from '../config/defaults.js';
import { getAppState } from '../state/index.js';
import { getAvailableRuntimes, getRuntimeForLanguage } from '../sandbox/runtimes.js';
import { evaluateCommand, evaluateFilePath } from '../security/policy.js';
import { resolveTokenProfile } from '../utils/token-estimator.js';

export interface DoctorToolInput {
  max_output_tokens?: number;
  response_mode?: ResponseMode;
}

export function doctorTool(input: DoctorToolInput = {}): string {
  const runtimes = getAvailableRuntimes();
  const shell = getRuntimeForLanguage('shell', DEFAULT_CONFIG.sandbox.shellDefault);
  const shellRuntime = shell?.runtimeId ?? shell?.command ?? 'unavailable';
  const state = getAppState();
  const profile = resolveTokenProfile();
  const cache = state.getCacheStats();
  const host = state.getHostInfo();
  const riskyCommand =
    process.platform === 'win32'
      ? 'Remove-Item -Recurse -Force C:\\temp\\danger'
      : 'rm -rf /tmp/danger';
  const riskyEval = evaluateCommand(riskyCommand);
  const envEval = evaluateFilePath('.env');
  const responseMode = input.response_mode ?? DEFAULT_CONFIG.compression.responseMode;

  if (responseMode !== 'full') {
    return [
      'doctor',
      `platform=${process.platform}`,
      `host=${host.id}`,
      `node=${process.version}`,
      `shell=${shellRuntime}`,
      `policy=${DEFAULT_CONFIG.security.policyMode}`,
      `state_dir=${DEFAULT_CONFIG.storage.stateDir}`,
      `db=${state.getDbPath()}`,
      `fts5=${state.isFts5Ready() ? 'ready' : 'unavailable'}`,
      `token_profile=${profile.active}`,
      `token_method=${profile.method}`,
      `cache_entries=${cache.entries}`,
      `cache_hits=${cache.hits}`,
      `runtime_count=${runtimes.length}`,
      `safety_cmd=${riskyEval.decision}`,
      `safety_env=${envEval.denied ? 'deny' : 'allow'}`,
    ].join('\n');
  }

  const lines = [
    '=== Kanso Context Mode Doctor ===',
    `Platform: ${process.platform}`,
    `Resolved host: ${host.id} (${host.confidence} confidence, ${host.reason})`,
    `Node: ${process.version}`,
    `Default shell: ${DEFAULT_CONFIG.sandbox.shellDefault}`,
    `Resolved shell runtime: ${shellRuntime}`,
    `Policy mode: ${DEFAULT_CONFIG.security.policyMode}`,
    `Private-network fetches: ${DEFAULT_CONFIG.security.allowPrivateNetworkFetch ? 'allowed' : 'blocked'}`,
    `State dir: ${DEFAULT_CONFIG.storage.stateDir}`,
    `Database: ${state.getDbPath()}`,
    `FTS5 available: ${state.isFts5Ready() ? 'yes' : 'no'}`,
    `Project root: ${state.getProjectRoot()}`,
    `Handle TTL: ${DEFAULT_CONFIG.storage.handleTtlHours} hours`,
    `Hot cache budget: ${DEFAULT_CONFIG.storage.hotCacheMB} MB / ${DEFAULT_CONFIG.storage.hotCacheEntries} entries`,
    `Hot cache TTL: ${Math.round(DEFAULT_CONFIG.storage.hotCacheTtlMs / 1000)} seconds`,
    `Cleanup cadence: every ${DEFAULT_CONFIG.storage.cleanupEveryWrites} writes`,
    `Session max events: ${DEFAULT_CONFIG.storage.sessionMaxEvents}`,
    `Session snapshot budget: ${DEFAULT_CONFIG.storage.sessionSnapshotBytes} bytes`,
    `Token estimator: ${profile.active} (${profile.method})`,
    `Default token budget: ${DEFAULT_CONFIG.compression.defaultMaxOutputTokens}`,
    `Hard token budget: ${DEFAULT_CONFIG.compression.hardMaxOutputTokens}`,
    `Max file size: ${DEFAULT_CONFIG.sandbox.maxFileBytes} bytes`,
    `Execution timeout: ${DEFAULT_CONFIG.sandbox.timeoutMs} ms`,
    '',
    'Hot cache',
    `  Entries: ${cache.entries}`,
    `  Memory: ${cache.bytes} bytes`,
    `  Hits: ${cache.hits}`,
    `  Misses: ${cache.misses}`,
    '',
    `Safety self-check (command): ${riskyEval.decision.toUpperCase()} (${riskyEval.matchedPattern ?? 'n/a'})`,
    `Safety self-check (.env path): ${envEval.denied ? 'DENY' : 'ALLOW'} (${envEval.matchedPattern ?? 'n/a'})`,
    '',
    `Available runtimes (${runtimes.length}):`,
    ...runtimes.map(runtime => `- ${runtime.language}: ${runtime.command}`),
  ];

  return lines.join('\n');
}
