import { DEFAULT_CONFIG, type ResponseMode } from '../config/defaults.js';
import { contextResourceLink, runResourceLink } from '../resources/registry.js';
import { getAppState } from '../state/index.js';
import { asToolResult, type ToolExecutionResult } from './tool-result.js';

export interface RunFocusToolInput {
  run_id: number;
  max_output_tokens?: number;
  response_mode?: ResponseMode;
}

export function runFocusTool(input: RunFocusToolInput): ToolExecutionResult {
  if (typeof input.run_id !== 'number' || !Number.isFinite(input.run_id) || input.run_id <= 0) {
    return asToolResult('Error: run_focus requires a positive numeric "run_id"');
  }

  const run = getAppState().getTerminalRun(Math.floor(input.run_id));
  if (!run) {
    return asToolResult(`Error: unknown run_id "${input.run_id}"`);
  }

  const handle = run.outputHandleId ? getAppState().getHandle(run.outputHandleId) : undefined;
  const responseMode = input.response_mode ?? DEFAULT_CONFIG.compression.responseMode;
  const outputText = handle?.content ?? run.outputPreview ?? '';
  const text =
    responseMode === 'minimal'
      ? [
          `run_focus id=${run.id}`,
          `status=${run.timedOut ? 'timeout' : run.exitCode === 0 ? 'ok' : `exit_${run.exitCode}`}`,
          `command=${run.command}`,
          outputText.slice(0, 280),
        ].join('\n')
      : [
          '=== Run Focus ===',
          `run_id: ${run.id}`,
          `command: ${run.command}`,
          `cwd: ${run.cwd}`,
          `language: ${run.language}`,
          `runtime: ${run.runtime ?? 'n/a'}`,
          `status: ${run.timedOut ? 'timeout' : run.exitCode === 0 ? 'ok' : `exit ${run.exitCode}`}`,
          `duration_ms: ${run.durationMs}`,
          `output_handle_id: ${run.outputHandleId ?? 'n/a'}`,
          '',
          outputText || '(no output)',
        ].join('\n');

  const resourceLinks = [runResourceLink(run.id, run.command)];
  if (run.outputHandleId) {
    resourceLinks.push(contextResourceLink(run.outputHandleId, `run:${run.id}`));
  }

  return asToolResult(text, {
    sourceText: outputText,
    candidateText: text,
    comparisonBasis: 'terminal_run_output',
    resourceLinks,
  });
}
