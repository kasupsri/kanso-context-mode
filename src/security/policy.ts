import { DEFAULT_CONFIG } from '../config/defaults.js';
import { policyByMode } from './default-rules.js';

export type PermissionDecision = 'allow' | 'deny' | 'ask';

export interface SecurityPolicy {
  allow: string[];
  deny: string[];
  ask: string[];
  fileDeny: string[];
}

export interface PolicyResult {
  decision: PermissionDecision;
  matchedPattern?: string;
  command?: string;
}

export function getActivePolicy(): SecurityPolicy {
  return policyByMode(DEFAULT_CONFIG.security.policyMode);
}

function globToRegex(glob: string, caseInsensitive = process.platform === 'win32'): RegExp {
  const escaped = glob.replace(/[.+?^${}()|[\]\\/-]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`, caseInsensitive ? 'i' : '');
}

function fileGlobToRegex(glob: string, caseInsensitive = process.platform === 'win32'): RegExp {
  let regex = '';
  let i = 0;
  while (i < glob.length) {
    if (glob[i] === '*' && glob[i + 1] === '*') {
      if (glob[i + 2] === '/') {
        regex += '(.*/)?';
        i += 3;
      } else {
        regex += '.*';
        i += 2;
      }
    } else if (glob[i] === '*') {
      regex += '[^/]*';
      i += 1;
    } else if (glob[i] === '?') {
      regex += '[^/]';
      i += 1;
    } else {
      regex += (glob[i] ?? '').replace(/[.+^${}()|[\]\\/-]/g, '\\$&');
      i += 1;
    }
  }
  return new RegExp(`^${regex}$`, caseInsensitive ? 'i' : '');
}

export function splitChainedCommands(command: string): string[] {
  const parts: string[] = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;
  let inBacktick = false;

  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i] ?? '';
    const prev = i > 0 ? (command[i - 1] ?? '') : '';

    if (ch === "'" && !inDouble && !inBacktick && prev !== '\\') {
      inSingle = !inSingle;
      current += ch;
      continue;
    }
    if (ch === '"' && !inSingle && !inBacktick && prev !== '\\') {
      inDouble = !inDouble;
      current += ch;
      continue;
    }
    if (ch === '`' && !inSingle && !inDouble && prev !== '\\') {
      inBacktick = !inBacktick;
      current += ch;
      continue;
    }

    if (!inSingle && !inDouble && !inBacktick) {
      if (ch === ';') {
        if (current.trim()) parts.push(current.trim());
        current = '';
        continue;
      }
      if ((ch === '&' && command[i + 1] === '&') || (ch === '|' && command[i + 1] === '|')) {
        if (current.trim()) parts.push(current.trim());
        current = '';
        i += 1;
        continue;
      }
      if (ch === '|') {
        if (current.trim()) parts.push(current.trim());
        current = '';
        continue;
      }
    }
    current += ch;
  }

  if (current.trim()) parts.push(current.trim());
  return parts;
}

export function evaluateCommand(
  command: string,
  policy: SecurityPolicy = getActivePolicy()
): PolicyResult {
  const segments = splitChainedCommands(command);

  for (const segment of segments) {
    for (const deny of policy.deny) {
      if (globToRegex(deny).test(segment)) {
        return { decision: 'deny', matchedPattern: deny, command: segment };
      }
    }
  }

  for (const ask of policy.ask) {
    if (globToRegex(ask).test(command)) {
      return { decision: 'ask', matchedPattern: ask, command };
    }
  }

  if (policy.allow.length > 0) {
    for (const allow of policy.allow) {
      if (globToRegex(allow).test(command)) {
        return { decision: 'allow', matchedPattern: allow, command };
      }
    }
    return { decision: 'ask' };
  }

  return { decision: 'allow' };
}

export function evaluateFilePath(
  filePath: string,
  policy: SecurityPolicy = getActivePolicy()
): { denied: boolean; matchedPattern?: string } {
  const normalized = filePath.replace(/\\/g, '/');
  for (const glob of policy.fileDeny) {
    if (fileGlobToRegex(glob).test(normalized)) {
      return { denied: true, matchedPattern: glob };
    }
  }
  return { denied: false };
}

const SHELL_ESCAPE_PATTERNS: Record<string, RegExp[]> = {
  python: [
    /os\.system\(\s*(['"])(.*?)\1\s*\)/g,
    /subprocess\.(?:run|call|Popen|check_output|check_call)\(\s*(['"])(.*?)\1/g,
  ],
  javascript: [
    /exec(?:Sync|File|FileSync)?\(\s*(['"`])(.*?)\1/g,
    /spawn(?:Sync)?\(\s*(['"`])(.*?)\1/g,
  ],
  typescript: [
    /exec(?:Sync|File|FileSync)?\(\s*(['"`])(.*?)\1/g,
    /spawn(?:Sync)?\(\s*(['"`])(.*?)\1/g,
  ],
  ruby: [/system\(\s*(['"])(.*?)\1/g, /`(.*?)`/g],
  go: [/exec\.Command\(\s*(['"`])(.*?)\1/g],
  php: [
    /shell_exec\(\s*(['"`])(.*?)\1/g,
    /(?:^|[^.])exec\(\s*(['"`])(.*?)\1/g,
    /(?:^|[^.])system\(\s*(['"`])(.*?)\1/g,
    /passthru\(\s*(['"`])(.*?)\1/g,
  ],
  rust: [/Command::new\(\s*(['"`])(.*?)\1/g],
};

function extractPythonListSubprocess(code: string): string[] {
  const commands: string[] = [];
  const regex = /subprocess\.(?:run|call|Popen|check_output|check_call)\(\s*\[([^\]]+)\]/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(code)) !== null) {
    const listContent = match[1] ?? '';
    const args = [...listContent.matchAll(/(['"])(.*?)\1/g)].map(m => m[2]);
    if (args.length > 0) commands.push(args.join(' '));
  }
  return commands;
}

export function extractShellCommands(code: string, language: string): string[] {
  const key = language.toLowerCase();
  const patterns = SHELL_ESCAPE_PATTERNS[key];
  const found: string[] = [];

  if (patterns) {
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(code)) !== null) {
        const cmd = match[match.length - 1];
        if (cmd) found.push(cmd);
      }
    }
  }

  if (key === 'python') {
    found.push(...extractPythonListSubprocess(code));
  }

  return found;
}

export function denyReason(result: PolicyResult): string {
  if (!result.matchedPattern) return 'Blocked by security policy.';
  if (result.command) {
    return `Blocked by security policy: "${result.command}" matches "${result.matchedPattern}"`;
  }
  return `Blocked by security policy: matches "${result.matchedPattern}"`;
}
