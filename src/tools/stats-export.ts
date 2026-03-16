import { DEFAULT_CONFIG, type ResponseMode } from '../config/defaults.js';
import { evaluateFilePath } from '../security/policy.js';
import { getAppState } from '../state/index.js';

export interface StatsExportInput {
  path?: string;
  max_output_tokens?: number;
  response_mode?: ResponseMode;
}

export function statsExportTool(input: StatsExportInput): string {
  const targetPath = input.path ?? DEFAULT_CONFIG.stats.exportPath;
  if (targetPath) {
    const denied = evaluateFilePath(targetPath);
    if (denied.denied) {
      return `Blocked by security policy: file path matches "${denied.matchedPattern}"`;
    }
  }

  const path = getAppState().exportStats(targetPath);
  const responseMode = input.response_mode ?? DEFAULT_CONFIG.compression.responseMode;
  return responseMode === 'full' ? `Stats exported to: ${path}` : `ok:stats_export path=${path}`;
}
