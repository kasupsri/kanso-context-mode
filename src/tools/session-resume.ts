import { DEFAULT_CONFIG, type ResponseMode } from '../config/defaults.js';
import { sessionResourceLink } from '../resources/registry.js';
import { type HostId } from '../runtime/host.js';
import { getAppState } from '../state/index.js';
import { asToolResult, type ToolExecutionResult } from './tool-result.js';

export interface SessionResumeToolInput {
  host?: HostId;
  session_id?: string;
  max_events?: number;
  max_output_tokens?: number;
  response_mode?: ResponseMode;
}

export function sessionResumeTool(input: SessionResumeToolInput = {}): ToolExecutionResult {
  const snapshot = getAppState().buildSessionResume({
    host: input.host,
    externalSessionId: input.session_id,
    maxEvents:
      typeof input.max_events === 'number' &&
      Number.isFinite(input.max_events) &&
      input.max_events > 0
        ? Math.floor(input.max_events)
        : undefined,
  });
  const responseMode = input.response_mode ?? DEFAULT_CONFIG.compression.responseMode;
  const text =
    responseMode === 'full'
      ? snapshot.text
      : `ok:session_resume host=${snapshot.host} events=${snapshot.eventCount} session=${snapshot.externalSessionId ?? 'latest'}`;

  return asToolResult(text, {
    sourceText: snapshot.fullText,
    candidateText: snapshot.fullText,
    comparisonBasis: 'session_snapshot_source',
    resourceLinks: [sessionResourceLink(snapshot.host, snapshot.externalSessionId ?? 'latest')],
  });
}
