import { executeCode, type ExecuteResult } from '../sandbox/executor.js';
import { type Language, type ShellRuntime, isShellLanguage } from '../sandbox/runtimes.js';
import { DEFAULT_CONFIG } from '../config/defaults.js';
import { type ResponseMode } from '../config/defaults.js';
import { denyReason, evaluateCommand, extractShellCommands } from '../security/policy.js';
import { contextResourceLink, runResourceLink } from '../resources/registry.js';
import { getAppState } from '../state/index.js';
import { asToolResult, type ToolExecutionResult } from './tool-result.js';

export interface ExecuteToolInput {
  language: Language;
  code: string;
  intent?: string;
  timeout?: number;
  max_output_tokens?: number;
  shell_runtime?: ShellRuntime;
  response_mode?: ResponseMode;
  return_context_id?: boolean;
  record_session?: boolean;
}

function securityCheck(language: Language, code: string): string | null {
  if (isShellLanguage(language)) {
    const decision = evaluateCommand(code);
    if (decision.decision === 'deny' || decision.decision === 'ask') {
      return denyReason(decision);
    }
    return null;
  }

  const embedded = extractShellCommands(code, language);
  for (const cmd of embedded) {
    const decision = evaluateCommand(cmd);
    if (decision.decision === 'deny' || decision.decision === 'ask') {
      return denyReason(decision);
    }
  }
  return null;
}

export async function executeTool(input: ExecuteToolInput): Promise<ToolExecutionResult | string> {
  const denied = securityCheck(input.language, input.code);
  if (denied) {
    return denied;
  }

  const timeoutMs =
    typeof input.timeout === 'number' && Number.isFinite(input.timeout) && input.timeout > 0
      ? Math.floor(input.timeout)
      : DEFAULT_CONFIG.sandbox.timeoutMs;

  const result: ExecuteResult = await executeCode({
    language: input.language,
    code: input.code,
    timeoutMs,
    memoryMB: DEFAULT_CONFIG.sandbox.memoryMB,
    shellRuntime: input.shell_runtime,
    allowAuthPassthrough: DEFAULT_CONFIG.sandbox.allowAuthPassthrough,
  });
  const responseMode = input.response_mode ?? DEFAULT_CONFIG.compression.responseMode;

  let rawOutput = result.stdout;
  if (result.stderr) {
    rawOutput += `${rawOutput ? '\n' : ''}STDERR:\n${result.stderr}`;
  }
  if (result.timedOut) {
    rawOutput = `[TIMEOUT after ${timeoutMs}ms]\n${rawOutput}`;
  }
  if (result.exitCode !== 0 && !result.timedOut) {
    rawOutput += `\n[Exit code: ${result.exitCode}]`;
  }

  const state = getAppState();
  const commandLabel = isShellLanguage(input.language)
    ? input.code.trim()
    : `${input.language} snippet: ${input.code.trim().split('\n', 1)[0] ?? ''}`.trim();
  const handle =
    rawOutput.trim() || input.return_context_id
      ? state.saveHandle(rawOutput || 'ok', `execute:${input.language}`)
      : undefined;
  const recordedRun =
    input.record_session === false
      ? undefined
      : state.recordTerminalRun({
          command: commandLabel,
          cwd: process.cwd(),
          language: input.language,
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
      resourceLinks: [
        ...(recordedRun ? [runResourceLink(recordedRun.id, commandLabel)] : []),
        ...(handle && (input.return_context_id ?? true)
          ? [contextResourceLink(handle.id, `execute:${input.language}`)]
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
      comparisonBasis: 'terminal_run_output',
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
    resourceLinks: [
      ...(recordedRun ? [runResourceLink(recordedRun.id, commandLabel)] : []),
      ...(handle && (input.return_context_id ?? true)
        ? [contextResourceLink(handle.id, `execute:${input.language}`)]
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
    comparisonBasis: 'terminal_run_output',
  });
}
