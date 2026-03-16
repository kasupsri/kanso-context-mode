import type { HostId } from '../runtime/host.js';

export type ComparisonBasis =
  | 'raw_output'
  | 'full_file'
  | 'raw_diff'
  | 'raw_log'
  | 'indexed_source'
  | 'session_snapshot_source'
  | 'workspace_source'
  | 'terminal_run_output'
  | 'web_search_source';

export interface ToolResourceLink {
  type: 'resource_link';
  uri: string;
  name: string;
  title?: string;
  description?: string;
  mimeType?: string;
}

export interface SessionEventRecord {
  type: string;
  category: string;
  priority: number;
  data: string;
}

export interface ToolTrackingMetrics {
  sourceBytes?: number;
  candidateBytes?: number;
  outputBytes?: number;
  sourceTokens?: number;
  candidateTokens?: number;
  outputTokens?: number;
}

export interface ToolExecutionResult {
  text: string;
  sourceText?: string;
  candidateText?: string;
  comparisonBasis?: ComparisonBasis;
  sessionEvents?: SessionEventRecord[];
  host?: HostId;
  externalSessionId?: string;
  resourceLinks?: ToolResourceLink[];
  tracking?: ToolTrackingMetrics;
}

export function asToolResult(
  text: string,
  options: Omit<ToolExecutionResult, 'text'> = {}
): ToolExecutionResult {
  return {
    text,
    ...options,
  };
}
