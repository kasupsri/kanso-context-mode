import { DEFAULT_CONFIG, type ResponseMode } from '../config/defaults.js';
import { getAppState } from '../state/index.js';

export interface StatsReportToolInput {
  max_output_tokens?: number;
  response_mode?: ResponseMode;
}

export function statsReportTool(input: StatsReportToolInput = {}): string {
  const responseMode = input.response_mode ?? DEFAULT_CONFIG.compression.responseMode;
  return getAppState().formatStatsReport(responseMode);
}
