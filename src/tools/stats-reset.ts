import { DEFAULT_CONFIG, type ResponseMode } from '../config/defaults.js';
import { getAppState } from '../state/index.js';

export interface StatsResetToolInput {
  max_output_tokens?: number;
  response_mode?: ResponseMode;
}

export function statsResetTool(input: StatsResetToolInput = {}): string {
  const sessionId = getAppState().resetSession();
  const responseMode = input.response_mode ?? DEFAULT_CONFIG.compression.responseMode;
  return responseMode === 'full'
    ? `Session statistics reset. New session: ${sessionId}`
    : `ok:stats_reset session=${sessionId}`;
}
