import { executeFile } from '../sandbox/executor.js';
import { DEFAULT_CONFIG } from '../config/defaults.js';
import { type ResponseMode } from '../config/defaults.js';
import {
  denyReason,
  evaluateCommand,
  evaluateFilePath,
  extractShellCommands,
} from '../security/policy.js';
import { contextResourceLink, runResourceLink } from '../resources/registry.js';
import { getAppState } from '../state/index.js';
import { asToolResult, type ToolExecutionResult } from './tool-result.js';
import { normalizeIncomingPath } from '../utils/path-input.js';

export interface ExecuteFileToolInput {
  file_path: string;
  code: string;
  intent?: string;
  timeout?: number;
  max_output_tokens?: number;
  response_mode?: ResponseMode;
  return_context_id?: boolean;
  record_session?: boolean;
}

export async function executeFileTool(
  input: ExecuteFileToolInput
): Promise<ToolExecutionResult | string> {
  const resolvedPath = normalizeIncomingPath(input.file_path);
  const fileCheck = evaluateFilePath(resolvedPath);
  if (fileCheck.denied) {
    return `Blocked by security policy: file path matches "${fileCheck.matchedPattern}"`;
  }

  const embeddedCommands = extractShellCommands(input.code, 'javascript');
  for (const cmd of embeddedCommands) {
    const decision = evaluateCommand(cmd);
    if (decision.decision === 'deny' || decision.decision === 'ask') {
      return denyReason(decision);
    }
  }

  const timeoutMs =
    typeof input.timeout === 'number' && Number.isFinite(input.timeout) && input.timeout > 0
      ? Math.floor(input.timeout)
      : DEFAULT_CONFIG.sandbox.timeoutMs;

  const result = await executeFile(resolvedPath, input.code, {
    timeoutMs,
    maxFileBytes: DEFAULT_CONFIG.sandbox.maxFileBytes,
  });
  const responseMode = input.response_mode ?? DEFAULT_CONFIG.compression.responseMode;
  let rawOutput = result.stdout;
  if (result.stderr) {
    rawOutput += `${rawOutput ? '\n' : ''}STDERR:\n${result.stderr}`;
  }
  if (result.exitCode !== 0 && !result.timedOut) {
    rawOutput += `\n[Exit code: ${result.exitCode}]`;
  }
  if (result.timedOut) {
    rawOutput = `[TIMEOUT after ${timeoutMs}ms]\n${rawOutput}`;
  }

  const state = getAppState();
  const commandLabel = `execute_file ${resolvedPath}`;
  const handle =
    rawOutput.trim() || input.return_context_id
      ? state.saveHandle(rawOutput || 'ok', `execute_file:${resolvedPath}`)
      : undefined;
  const recordedRun =
    input.record_session === false
      ? undefined
      : state.recordTerminalRun({
          command: commandLabel,
          cwd: process.cwd(),
          language: 'javascript',
          runtime: result.runtime,
          exitCode: result.exitCode,
          timedOut: result.timedOut,
          durationMs: result.durationMs,
          outputHandleId: handle?.id,
          outputText: rawOutput,
          stderrText: result.stderr,
        });

  if (responseMode === 'full') {
    return asToolResult(rawOutput || 'ok', {
      sourceText: rawOutput || 'ok',
      candidateText: rawOutput || 'ok',
      comparisonBasis: 'terminal_run_output',
      resourceLinks: [
        ...(recordedRun ? [runResourceLink(recordedRun.id, commandLabel)] : []),
        ...(handle && (input.return_context_id ?? true)
          ? [contextResourceLink(handle.id, `execute_file:${resolvedPath}`)]
          : []),
      ],
      sessionEvents:
        input.record_session === false
          ? []
          : [
              {
                type: 'command',
                category: 'command',
                priority: 1,
                data: commandLabel.slice(0, 400),
              },
              {
                type: 'file_read',
                category: 'file',
                priority: 1,
                data: resolvedPath,
              },
              ...(result.exitCode !== 0 || result.timedOut
                ? [
                    {
                      type: 'error',
                      category: 'error',
                      priority: 2,
                      data: rawOutput.slice(0, 400),
                    },
                  ]
                : []),
            ],
    });
  }

  const parts: string[] = [];
  if (result.timedOut) parts.push(`timeout:${timeoutMs}ms`);
  if (result.stderr.trim()) parts.push(`err:${result.stderr.trim()}`);
  if (result.stdout.trim()) parts.push(result.stdout.trimEnd());
  if (result.exitCode !== 0 && !result.timedOut) parts.push(`code:${result.exitCode}`);
  const text = parts.join('\n') || 'ok';
  return asToolResult(text, {
    sourceText: rawOutput || text,
    candidateText: text,
    comparisonBasis: 'terminal_run_output',
    resourceLinks: [
      ...(recordedRun ? [runResourceLink(recordedRun.id, commandLabel)] : []),
      ...(handle && (input.return_context_id ?? true)
        ? [contextResourceLink(handle.id, `execute_file:${resolvedPath}`)]
        : []),
    ],
    sessionEvents:
      input.record_session === false
        ? []
        : [
            {
              type: 'command',
              category: 'command',
              priority: 1,
              data: commandLabel.slice(0, 400),
            },
            {
              type: 'file_read',
              category: 'file',
              priority: 1,
              data: resolvedPath,
            },
            ...(result.exitCode !== 0 || result.timedOut
              ? [
                  {
                    type: 'error',
                    category: 'error',
                    priority: 2,
                    data: rawOutput.slice(0, 400),
                  },
                ]
              : []),
          ],
  });
}
