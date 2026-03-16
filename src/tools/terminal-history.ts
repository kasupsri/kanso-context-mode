import { DEFAULT_CONFIG, type ResponseMode } from '../config/defaults.js';
import { contextResourceLink, runResourceLink } from '../resources/registry.js';
import { getAppState } from '../state/index.js';
import { asToolResult, type ToolExecutionResult } from './tool-result.js';
import { parsePositiveInteger } from './file-selectors.js';

export interface TerminalHistoryToolInput {
  limit?: number;
  failed_only?: boolean;
  query?: string;
  cwd?: string;
  with_output_handles?: boolean;
  max_output_tokens?: number;
  response_mode?: ResponseMode;
}

export function terminalHistoryTool(input: TerminalHistoryToolInput = {}): ToolExecutionResult {
  const parsedLimit = parsePositiveInteger(input.limit, 'terminal_history.limit');
  if (typeof parsedLimit === 'string') return asToolResult(parsedLimit);

  const responseMode = input.response_mode ?? DEFAULT_CONFIG.compression.responseMode;
  const runs = getAppState().listTerminalRuns({
    limit: parsedLimit ?? 20,
    failedOnly: input.failed_only ?? false,
    query: input.query,
    cwd: input.cwd,
  });
  const sourceText = runs
    .map(
      run =>
        `run=${run.id}\ncommand=${run.command}\ncwd=${run.cwd}\nlanguage=${run.language}\npreview=${run.outputPreview}`
    )
    .join('\n\n');

  const text =
    runs.length === 0
      ? responseMode === 'minimal'
        ? 'terminal_history none'
        : 'No terminal runs recorded yet.'
      : responseMode === 'minimal'
        ? [
            `terminal_history runs=${runs.length}`,
            ...runs.map(
              run =>
                `${run.id} ${run.exitCode !== 0 || run.timedOut ? 'fail' : 'ok'} ${run.language} ${run.command.slice(0, 80)}`
            ),
          ].join('\n')
        : [
            '=== Terminal History ===',
            `runs: ${runs.length}`,
            ...runs.map(run =>
              [
                '',
                `### Run ${run.id}`,
                `command: ${run.command}`,
                `cwd: ${run.cwd}`,
                `language: ${run.language}`,
                `runtime: ${run.runtime ?? 'n/a'}`,
                `status: ${run.timedOut ? 'timeout' : run.exitCode === 0 ? 'ok' : `exit ${run.exitCode}`}`,
                `duration_ms: ${run.durationMs}`,
                `preview: ${run.outputPreview || '(no output)'}`,
              ].join('\n')
            ),
          ].join('\n');

  const resourceLinks = runs.flatMap(run => {
    const links = [runResourceLink(run.id, run.command)];
    if (input.with_output_handles !== false && run.outputHandleId) {
      links.push(contextResourceLink(run.outputHandleId, `run:${run.id}`));
    }
    return links;
  });

  return asToolResult(text, {
    sourceText,
    candidateText: text,
    comparisonBasis: 'terminal_run_output',
    resourceLinks,
  });
}
