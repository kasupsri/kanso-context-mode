import { executeCode, type ExecuteResult } from '../sandbox/executor.js';
import { type Language, type ShellRuntime, isShellLanguage } from '../sandbox/runtimes.js';
import { DEFAULT_CONFIG } from '../config/defaults.js';
import { type ResponseMode } from '../config/defaults.js';
import { denyReason, evaluateCommand, extractShellCommands } from '../security/policy.js';

export interface ExecuteToolInput {
  language: Language;
  code: string;
  intent?: string;
  timeout?: number;
  max_output_tokens?: number;
  shell_runtime?: ShellRuntime;
  response_mode?: ResponseMode;
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

export async function executeTool(input: ExecuteToolInput): Promise<string> {
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

  if (responseMode === 'full') {
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
    return rawOutput;
  }

  const parts: string[] = [];
  if (result.timedOut) parts.push(`timeout:${timeoutMs}ms`);
  if (result.stderr.trim()) parts.push(`err:${result.stderr.trim()}`);
  if (result.stdout.trim()) parts.push(result.stdout.trimEnd());
  if (result.exitCode !== 0 && !result.timedOut) parts.push(`code:${result.exitCode}`);
  return parts.join('\n') || 'ok';
}
