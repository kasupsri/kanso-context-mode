import { executeFile } from '../sandbox/executor.js';
import { DEFAULT_CONFIG } from '../config/defaults.js';
import { type ResponseMode } from '../config/defaults.js';
import {
  denyReason,
  evaluateCommand,
  evaluateFilePath,
  extractShellCommands,
} from '../security/policy.js';

export interface ExecuteFileToolInput {
  file_path: string;
  code: string;
  intent?: string;
  timeout?: number;
  max_output_tokens?: number;
  response_mode?: ResponseMode;
}

export async function executeFileTool(input: ExecuteFileToolInput): Promise<string> {
  const fileCheck = evaluateFilePath(input.file_path);
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

  const result = await executeFile(input.file_path, input.code, {
    timeoutMs,
    maxFileBytes: DEFAULT_CONFIG.sandbox.maxFileBytes,
  });
  const responseMode = input.response_mode ?? DEFAULT_CONFIG.compression.responseMode;

  if (responseMode === 'full') {
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
    return rawOutput;
  }

  const parts: string[] = [];
  if (result.timedOut) parts.push(`timeout:${timeoutMs}ms`);
  if (result.stderr.trim()) parts.push(`err:${result.stderr.trim()}`);
  if (result.stdout.trim()) parts.push(result.stdout.trimEnd());
  if (result.exitCode !== 0 && !result.timedOut) parts.push(`code:${result.exitCode}`);
  return parts.join('\n') || 'ok';
}
