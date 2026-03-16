import type { HostId } from '../runtime/host.js';

export type ComparisonBasis =
  | 'raw_output'
  | 'full_file'
  | 'raw_diff'
  | 'raw_log'
  | 'indexed_source'
  | 'session_snapshot_source';

export interface SessionEventRecord {
  type: string;
  category: string;
  priority: number;
  data: string;
}

export interface ToolExecutionResult {
  text: string;
  sourceText?: string;
  candidateText?: string;
  comparisonBasis?: ComparisonBasis;
  sessionEvents?: SessionEventRecord[];
  host?: HostId;
  externalSessionId?: string;
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
