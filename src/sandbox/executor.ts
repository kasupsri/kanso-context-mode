import { spawn, spawnSync } from 'child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { buildSandboxEnv } from './auth-passthrough.js';
import {
  type Language,
  type ShellRuntime,
  getRuntimeForLanguage,
  isShellLanguage,
} from './runtimes.js';
import { DEFAULT_CONFIG } from '../config/defaults.js';
import { logger } from '../utils/logger.js';

export interface ExecuteOptions {
  language: Language;
  code: string;
  timeoutMs?: number;
  memoryMB?: number;
  env?: Record<string, string>;
  projectRoot?: string;
  shellRuntime?: ShellRuntime;
  allowAuthPassthrough?: boolean;
  maxFileBytes?: number;
}

export interface ExecuteResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
  language: Language;
  durationMs: number;
  runtime: string;
}

const HARD_OUTPUT_CAP_BYTES = 2 * 1024 * 1024; // 2MB

interface ProcessRunOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
}

interface ProcessRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
  durationMs: number;
}

function killProcessTree(pid: number): void {
  if (process.platform === 'win32') {
    try {
      spawnSync('taskkill', ['/F', '/T', '/PID', String(pid)], {
        stdio: 'ignore',
        windowsHide: true,
      });
    } catch {
      // Best effort.
    }
    return;
  }

  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    // Best effort.
  }
}

function smartTruncate(raw: string, maxBytes: number): string {
  if (Buffer.byteLength(raw, 'utf8') <= maxBytes) return raw;

  const lines = raw.split('\n');
  const headBudget = Math.floor(maxBytes * 0.6);
  const tailBudget = maxBytes - headBudget;

  const head: string[] = [];
  let headBytes = 0;
  for (const line of lines) {
    const lineBytes = Buffer.byteLength(line, 'utf8') + 1;
    if (headBytes + lineBytes > headBudget) break;
    head.push(line);
    headBytes += lineBytes;
  }

  const tail: string[] = [];
  let tailBytes = 0;
  for (let i = lines.length - 1; i >= head.length; i -= 1) {
    const lineBytes = Buffer.byteLength(lines[i] ?? '', 'utf8') + 1;
    if (tailBytes + lineBytes > tailBudget) break;
    tail.unshift(lines[i] ?? '');
    tailBytes += lineBytes;
  }

  const skipped = Math.max(0, lines.length - head.length - tail.length);
  return `${head.join('\n')}\n\n... [${skipped} lines omitted] ...\n\n${tail.join('\n')}`;
}

function mergeOutputs(parts: string[]): string {
  return parts.filter(Boolean).join('\n');
}

function isRustLanguage(language: Language): language is Extract<Language, 'rust' | 'rs'> {
  return language === 'rust' || language === 'rs';
}

async function runProcess(
  command: string,
  args: string[],
  options: ProcessRunOptions
): Promise<ProcessRunResult> {
  const startTime = Date.now();

  return await new Promise<ProcessRunResult>(resolve => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let totalBytes = 0;
    let exceeded = false;
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      if (child.pid) killProcessTree(child.pid);
    }, options.timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      totalBytes += chunk.length;
      if (totalBytes <= HARD_OUTPUT_CAP_BYTES) {
        stdoutChunks.push(chunk);
      } else if (!exceeded) {
        exceeded = true;
        if (child.pid) killProcessTree(child.pid);
      }
    });

    child.stderr.on('data', (chunk: Buffer) => {
      totalBytes += chunk.length;
      if (totalBytes <= HARD_OUTPUT_CAP_BYTES) {
        stderrChunks.push(chunk);
      } else if (!exceeded) {
        exceeded = true;
        if (child.pid) killProcessTree(child.pid);
      }
    });

    child.on('error', err => {
      clearTimeout(timer);
      resolve({
        stdout: '',
        stderr: err.message,
        exitCode: 1,
        timedOut: false,
        durationMs: Date.now() - startTime,
      });
    });

    child.on('close', code => {
      clearTimeout(timer);
      const stdout = Buffer.concat(stdoutChunks).toString('utf8');
      let stderr = Buffer.concat(stderrChunks).toString('utf8');

      if (timedOut) {
        stderr = `[Execution timed out after ${options.timeoutMs}ms]\n${stderr}`;
      }
      if (exceeded) {
        stderr = `${stderr}\n[output capped at ${(HARD_OUTPUT_CAP_BYTES / 1024 / 1024).toFixed(0)}MB]`;
      }

      resolve({
        stdout: smartTruncate(stdout, HARD_OUTPUT_CAP_BYTES),
        stderr: smartTruncate(stderr, HARD_OUTPUT_CAP_BYTES),
        exitCode: timedOut ? 1 : (code ?? 1),
        timedOut,
        durationMs: Date.now() - startTime,
      });
    });
  });
}

export async function executeCode(options: ExecuteOptions): Promise<ExecuteResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_CONFIG.sandbox.timeoutMs;
  const memoryMB = options.memoryMB ?? DEFAULT_CONFIG.sandbox.memoryMB;
  const runtime = getRuntimeForLanguage(options.language, options.shellRuntime);

  if (!runtime) {
    throw new Error(
      `Runtime for language "${options.language}" is not available. ` +
        'Ensure the required interpreter is installed.'
    );
  }

  const tmpDir = await mkdtemp(join(tmpdir(), 'wcm-exec-'));
  const filePath = join(tmpDir, `script.${runtime.extension}`);

  try {
    await writeFile(filePath, options.code, { encoding: 'utf8' });

    const cwd = isShellLanguage(options.language) ? (options.projectRoot ?? process.cwd()) : tmpDir;
    const env = buildSandboxEnv(
      options.env,
      options.allowAuthPassthrough ?? DEFAULT_CONFIG.sandbox.allowAuthPassthrough
    );
    let result: ExecuteResult;

    if (isRustLanguage(options.language)) {
      const binaryName = process.platform === 'win32' ? 'script.exe' : 'script-bin';
      const binaryPath = join(tmpDir, binaryName);
      const compileResult = await runProcess(
        runtime.command,
        [...runtime.args(filePath), '-o', binaryPath],
        {
          cwd: tmpDir,
          env,
          timeoutMs,
        }
      );

      if (compileResult.exitCode !== 0 || compileResult.timedOut) {
        result = {
          ...compileResult,
          language: options.language,
          runtime: runtime.runtimeId ?? runtime.command,
        };
      } else {
        const remainingTimeout = Math.max(1, timeoutMs - compileResult.durationMs);
        const runResult = await runProcess(binaryPath, [], {
          cwd: tmpDir,
          env,
          timeoutMs: remainingTimeout,
        });
        result = {
          stdout: mergeOutputs([compileResult.stdout, runResult.stdout]),
          stderr: mergeOutputs([compileResult.stderr, runResult.stderr]),
          exitCode: runResult.exitCode,
          timedOut: runResult.timedOut,
          language: options.language,
          durationMs: compileResult.durationMs + runResult.durationMs,
          runtime: runtime.runtimeId ?? runtime.command,
        };
      }
    } else {
      const cmd = runtime.command;
      let args = runtime.args(filePath);
      if (cmd === 'node' && memoryMB > 0) {
        args = [`--max-old-space-size=${memoryMB}`, ...args];
      }

      const runResult = await runProcess(cmd, args, { cwd, env, timeoutMs });
      result = {
        ...runResult,
        language: options.language,
        runtime: runtime.runtimeId ?? runtime.command,
      };
    }

    logger.debug('Code executed', {
      language: options.language,
      runtime: runtime.runtimeId ?? runtime.command,
      durationMs: result.durationMs,
      exitCode: result.exitCode,
      timedOut: result.timedOut,
    });

    return result;
  } finally {
    try {
      await rm(tmpDir, { recursive: true, force: true });
    } catch {
      // Best effort cleanup.
    }
  }
}

export async function executeFile(
  filePath: string,
  userCode: string,
  options: Omit<ExecuteOptions, 'code' | 'language'>
): Promise<ExecuteResult> {
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_CONFIG.sandbox.maxFileBytes;
  let fileStats;
  try {
    fileStats = await stat(filePath);
  } catch (err) {
    throw new Error(`Cannot stat file "${filePath}": ${String(err)}`);
  }

  if (!fileStats.isFile()) {
    throw new Error(`Path "${filePath}" is not a regular file`);
  }

  if (fileStats.size > maxFileBytes) {
    throw new Error(
      `File "${filePath}" is too large for execute_file (${fileStats.size} bytes > ${maxFileBytes} byte limit)`
    );
  }

  let fileContent: string;
  try {
    fileContent = await readFile(filePath, 'utf8');
  } catch (err) {
    throw new Error(`Cannot read file "${filePath}": ${String(err)}`);
  }

  return executeCode({
    ...options,
    language: 'javascript',
    code: userCode,
    env: {
      ...(options.env ?? {}),
      FILE_CONTENT: fileContent,
      FILE_PATH: filePath,
    },
  });
}
