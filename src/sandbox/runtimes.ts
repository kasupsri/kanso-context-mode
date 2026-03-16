import { execSync, execFileSync } from 'child_process';
import { existsSync } from 'fs';
import { DEFAULT_CONFIG } from '../config/defaults.js';

export type ShellRuntime = 'auto' | 'powershell' | 'cmd' | 'git-bash' | 'bash' | 'zsh' | 'sh';
type ConcreteShellRuntime = Exclude<ShellRuntime, 'auto'>;

export type Language =
  | 'javascript'
  | 'js'
  | 'typescript'
  | 'ts'
  | 'python'
  | 'py'
  | 'shell'
  | 'powershell'
  | 'cmd'
  | 'bash'
  | 'sh'
  | 'ruby'
  | 'rb'
  | 'go'
  | 'rust'
  | 'rs'
  | 'php'
  | 'perl'
  | 'pl'
  | 'r';

export interface Runtime {
  language: Language;
  command: string;
  args: (filePath: string) => string[];
  extension: string;
  available: boolean;
  runtimeId?: ConcreteShellRuntime;
}

const isWindows = process.platform === 'win32';

function commandExists(cmd: string): boolean {
  try {
    const probe = isWindows ? `where ${cmd}` : `command -v ${cmd}`;
    execSync(probe, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function isAvailable(cmd: string): boolean {
  try {
    execFileSync(cmd, ['--version'], { stdio: 'ignore', timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

function hasBun(): boolean {
  try {
    execFileSync('bun', ['--version'], { stdio: 'ignore', timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

function hasRustToolchain(): boolean {
  if (!isAvailable('rustc')) return false;

  if (isWindows) {
    return commandExists('link') || commandExists('lld-link');
  }

  return commandExists('cc') || commandExists('clang') || commandExists('gcc');
}

interface PythonRuntimeInfo {
  command: string;
  args: (filePath: string) => string[];
}

function detectPythonRuntime(): PythonRuntimeInfo | null {
  const sentinel = 'context-mode-python-ok';
  const baseProbe = `import sys; sys.stdout.write("${sentinel}")`;
  const candidates: PythonRuntimeInfo[] = isWindows
    ? [
        { command: 'python', args: filePath => [filePath] },
        { command: 'py', args: filePath => ['-3', filePath] },
        { command: 'python3', args: filePath => [filePath] },
      ]
    : [
        { command: 'python3', args: filePath => [filePath] },
        { command: 'python', args: filePath => [filePath] },
      ];

  for (const candidate of candidates) {
    try {
      const probeArgs = candidate.command === 'py' ? ['-3', '-c', baseProbe] : ['-c', baseProbe];
      const output = execFileSync(candidate.command, probeArgs, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 2500,
      });
      if (output.includes(sentinel)) {
        return candidate;
      }
    } catch {
      // Try next candidate.
    }
  }

  return null;
}

function detectPowerShellCommand(): string | null {
  if (commandExists('pwsh')) return 'pwsh';
  if (commandExists('powershell')) return 'powershell';
  return null;
}

function detectGitBashPath(): string | null {
  const knownPaths = [
    'C:\\Program Files\\Git\\usr\\bin\\bash.exe',
    'C:\\Program Files (x86)\\Git\\usr\\bin\\bash.exe',
  ];
  for (const p of knownPaths) {
    if (existsSync(p)) return p;
  }

  if (!isWindows) return commandExists('bash') ? 'bash' : null;

  try {
    const out = execSync('where bash', { encoding: 'utf8', stdio: 'pipe' });
    const candidates = out
      .split(/\r?\n/)
      .map(x => x.trim())
      .filter(Boolean);
    for (const p of candidates) {
      const lower = p.toLowerCase();
      if (lower.includes('system32') || lower.includes('windowsapps')) continue;
      return p;
    }
    return null;
  } catch {
    return null;
  }
}

const bunAvailable = hasBun();
const pythonRuntime = detectPythonRuntime();
const rustToolchainAvailable = hasRustToolchain();

const NON_SHELL_RUNTIMES: Runtime[] = [
  {
    language: 'javascript',
    command: bunAvailable ? 'bun' : 'node',
    args: f => [f],
    extension: 'js',
    available: bunAvailable || isAvailable('node'),
  },
  {
    language: 'js',
    command: bunAvailable ? 'bun' : 'node',
    args: f => [f],
    extension: 'js',
    available: bunAvailable || isAvailable('node'),
  },
  {
    language: 'typescript',
    command: bunAvailable ? 'bun' : 'tsx',
    args: f => [f],
    extension: 'ts',
    available: bunAvailable || isAvailable('tsx'),
  },
  {
    language: 'ts',
    command: bunAvailable ? 'bun' : 'tsx',
    args: f => [f],
    extension: 'ts',
    available: bunAvailable || isAvailable('tsx'),
  },
  {
    language: 'python',
    command: pythonRuntime?.command ?? 'python',
    args: f => (pythonRuntime ? pythonRuntime.args(f) : [f]),
    extension: 'py',
    available: pythonRuntime !== null,
  },
  {
    language: 'py',
    command: pythonRuntime?.command ?? 'python',
    args: f => (pythonRuntime ? pythonRuntime.args(f) : [f]),
    extension: 'py',
    available: pythonRuntime !== null,
  },
  {
    language: 'ruby',
    command: 'ruby',
    args: f => [f],
    extension: 'rb',
    available: isAvailable('ruby'),
  },
  {
    language: 'rb',
    command: 'ruby',
    args: f => [f],
    extension: 'rb',
    available: isAvailable('ruby'),
  },
  {
    language: 'go',
    command: 'go',
    args: f => ['run', f],
    extension: 'go',
    available: isAvailable('go'),
  },
  {
    language: 'rust',
    command: 'rustc',
    args: f => [f],
    extension: 'rs',
    available: rustToolchainAvailable,
  },
  {
    language: 'rs',
    command: 'rustc',
    args: f => [f],
    extension: 'rs',
    available: rustToolchainAvailable,
  },
  {
    language: 'php',
    command: 'php',
    args: f => [f],
    extension: 'php',
    available: isAvailable('php'),
  },
  {
    language: 'perl',
    command: 'perl',
    args: f => [f],
    extension: 'pl',
    available: isAvailable('perl'),
  },
  {
    language: 'pl',
    command: 'perl',
    args: f => [f],
    extension: 'pl',
    available: isAvailable('perl'),
  },
  {
    language: 'r',
    command: 'Rscript',
    args: f => [f],
    extension: 'r',
    available: isAvailable('Rscript'),
  },
];

export function autoShellCandidates(
  platform: NodeJS.Platform = process.platform
): ConcreteShellRuntime[] {
  if (platform === 'win32') {
    return ['powershell', 'cmd', 'git-bash', 'bash', 'sh'];
  }
  if (platform === 'darwin') {
    return ['zsh', 'bash', 'sh', 'powershell'];
  }
  return ['bash', 'sh', 'zsh', 'powershell'];
}

function shellCandidates(preferred: ShellRuntime): ConcreteShellRuntime[] {
  if (preferred === 'auto') return autoShellCandidates();
  return [preferred];
}

function buildPowerShellRuntime(): Runtime | null {
  const ps = detectPowerShellCommand();
  if (!ps) return null;
  return {
    language: 'shell',
    command: ps,
    args: f => [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      f,
    ],
    extension: 'ps1',
    available: true,
    runtimeId: 'powershell',
  };
}

function buildShellRuntime(kind: ConcreteShellRuntime): Runtime | null {
  if (kind === 'powershell') return buildPowerShellRuntime();

  if (kind === 'cmd') {
    if (!isWindows || !commandExists('cmd')) return null;
    return {
      language: 'shell',
      command: 'cmd.exe',
      args: f => ['/d', '/s', '/c', f],
      extension: 'cmd',
      available: true,
      runtimeId: 'cmd',
    };
  }

  if (kind === 'git-bash') {
    const gitBash = detectGitBashPath();
    if (!gitBash) return null;
    return {
      language: 'shell',
      command: gitBash,
      args: f => [isWindows ? f.replace(/\\/g, '/') : f],
      extension: 'sh',
      available: true,
      runtimeId: 'git-bash',
    };
  }

  if (kind === 'bash') {
    if (isWindows) {
      const bashPath = detectGitBashPath();
      if (!bashPath) return null;
      return {
        language: 'shell',
        command: bashPath,
        args: f => [f.replace(/\\/g, '/')],
        extension: 'sh',
        available: true,
        runtimeId: 'bash',
      };
    }
    if (!commandExists('bash')) return null;
    return {
      language: 'shell',
      command: 'bash',
      args: f => [f],
      extension: 'sh',
      available: true,
      runtimeId: 'bash',
    };
  }

  if (kind === 'zsh') {
    if (!commandExists('zsh')) return null;
    return {
      language: 'shell',
      command: 'zsh',
      args: f => [f],
      extension: 'sh',
      available: true,
      runtimeId: 'zsh',
    };
  }

  if (!commandExists('sh')) return null;
  return {
    language: 'shell',
    command: 'sh',
    args: f => [f],
    extension: 'sh',
    available: true,
    runtimeId: 'sh',
  };
}

export function isShellLanguage(
  language: Language
): language is Extract<Language, 'shell' | 'powershell' | 'cmd' | 'bash' | 'sh'> {
  return (
    language === 'shell' ||
    language === 'powershell' ||
    language === 'cmd' ||
    language === 'bash' ||
    language === 'sh'
  );
}

export function resolveShellRuntime(
  language: Extract<Language, 'shell' | 'powershell' | 'cmd' | 'bash' | 'sh'>,
  preferredShell?: ShellRuntime
): Runtime | undefined {
  if (language === 'powershell') return buildShellRuntime('powershell') ?? undefined;
  if (language === 'cmd') return buildShellRuntime('cmd') ?? undefined;
  if (language === 'bash') return buildShellRuntime('bash') ?? undefined;
  if (language === 'sh') return buildShellRuntime('sh') ?? undefined;

  const preferred = preferredShell ?? DEFAULT_CONFIG.sandbox.shellDefault;
  for (const candidate of shellCandidates(preferred)) {
    const runtime = buildShellRuntime(candidate);
    if (runtime?.available) {
      return runtime;
    }
  }
  return undefined;
}

export function getRuntimeForLanguage(
  language: Language,
  preferredShell?: ShellRuntime
): Runtime | undefined {
  if (isShellLanguage(language)) {
    return resolveShellRuntime(language, preferredShell);
  }
  return NON_SHELL_RUNTIMES.find(r => r.language === language && r.available);
}

export function getAvailableRuntimes(preferredShell?: ShellRuntime): Runtime[] {
  const available = NON_SHELL_RUNTIMES.filter(r => r.available);
  const shellLanguages: Array<Extract<Language, 'shell' | 'powershell' | 'cmd' | 'bash' | 'sh'>> = [
    'shell',
    'powershell',
    'cmd',
    'bash',
    'sh',
  ];
  for (const language of shellLanguages) {
    const shell = resolveShellRuntime(language, preferredShell);
    if (shell) {
      available.push({ ...shell, language });
    }
  }
  return available;
}
