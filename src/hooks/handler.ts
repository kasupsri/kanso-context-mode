import { getAppState } from '../state/index.js';
import { evaluateCommand, denyReason } from '../security/policy.js';
import { type HostId } from '../runtime/host.js';
import { type SessionEventRecord } from '../tools/tool-result.js';

interface HookPayload {
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_output?: string;
  error_message?: string;
  session_id?: string;
  transcript_path?: string;
  source?: string;
}

function parsePayload(raw: string): HookPayload {
  try {
    return JSON.parse(raw) as HookPayload;
  } catch {
    return {};
  }
}

function rawToolNudge(toolName?: string): string | null {
  if (!toolName) return null;
  const normalized = toolName.toLowerCase();
  if (!['bash', 'shell', 'read', 'grep', 'webfetch', 'task'].includes(normalized)) {
    return null;
  }
  return 'Prefer kanso-context-mode tools for token-heavy work: execute, read_file, read_symbols, read_references, workspace_search, tree_focus, git_focus, diagnostics_focus, terminal_history, run_focus, web_search, edit_targets, session_resume, and stats_report.';
}

function shellCommand(input: Record<string, unknown> | undefined): string | undefined {
  if (!input) return undefined;
  const code = input['command'] ?? input['code'];
  return typeof code === 'string' ? code : undefined;
}

function normalizeToolName(toolName?: string): string {
  if (!toolName) return '';
  return toolName.replace(/^MCP:/i, '').toLowerCase();
}

function extractExternalSessionId(payload: HookPayload): string | null {
  if (payload.session_id?.trim()) return payload.session_id.trim();
  const transcript = payload.transcript_path;
  if (!transcript) return null;
  const match = /([a-f0-9-]{16,})/i.exec(transcript);
  return match?.[1] ?? null;
}

function extractGitOperation(command: string): string | null {
  const checks: Array<[RegExp, string]> = [
    [/\bgit\s+status\b/i, 'status'],
    [/\bgit\s+diff\b/i, 'diff'],
    [/\bgit\s+log\b/i, 'log'],
    [/\bgit\s+commit\b/i, 'commit'],
    [/\bgit\s+checkout\b/i, 'checkout'],
    [/\bgit\s+branch\b/i, 'branch'],
    [/\bgit\s+pull\b/i, 'pull'],
    [/\bgit\s+push\b/i, 'push'],
  ];
  for (const [pattern, operation] of checks) {
    if (pattern.test(command)) return operation;
  }
  return null;
}

function extractSessionEvents(payload: HookPayload): SessionEventRecord[] {
  const toolName = normalizeToolName(payload.tool_name);
  const toolInput = payload.tool_input ?? {};
  const output = payload.error_message ?? payload.tool_output ?? '';
  const events: SessionEventRecord[] = [];

  const push = (event: SessionEventRecord | null) => {
    if (!event || !event.data.trim()) return;
    events.push({ ...event, data: event.data.trim().slice(0, 400) });
  };

  if (toolName === 'read' || toolName === 'read_file') {
    const filePath = toolInput['file_path'] ?? toolInput['path'];
    if (typeof filePath === 'string') {
      push({ type: 'file_read', category: 'file', priority: 1, data: filePath });
    }
  }

  if (toolName === 'edit' || toolName === 'write') {
    const filePath = toolInput['file_path'] ?? toolInput['path'];
    if (typeof filePath === 'string') {
      push({ type: 'file_write', category: 'file', priority: 1, data: filePath });
    }
  }

  if (toolName === 'task' || toolName === 'todowrite') {
    push({
      type: 'task',
      category: 'task',
      priority: 1,
      data: JSON.stringify(toolInput),
    });
  }

  const command = shellCommand(toolInput);
  if (command) {
    push({ type: 'command', category: 'command', priority: 1, data: command });
    const gitOperation = extractGitOperation(command);
    if (gitOperation) {
      push({ type: 'git', category: 'git', priority: 2, data: gitOperation });
    }
    if (/\bcd\s+/i.test(command)) {
      push({ type: 'cwd', category: 'env', priority: 2, data: command });
    }
  }

  if (toolName === 'session_resume') {
    push({
      type: 'session_resume',
      category: 'decision',
      priority: 2,
      data: 'session resume requested',
    });
  }

  if (toolName === 'webfetch' || toolName === 'web_search') {
    const target =
      (typeof toolInput['url'] === 'string' && toolInput['url']) ||
      (typeof toolInput['query'] === 'string' && toolInput['query']) ||
      (typeof toolInput['prompt'] === 'string' && toolInput['prompt']) ||
      '';
    if (target) {
      push({
        type: 'web_lookup',
        category: 'web',
        priority: 1,
        data: target,
      });
    }
  }

  if (output && /error|failed|exception|timeout/i.test(output)) {
    push({
      type: 'error',
      category: 'error',
      priority: 2,
      data: output,
    });
  }

  return events;
}

function recordSessionEvents(host: HostId, payload: HookPayload): void {
  const events = extractSessionEvents(payload);
  if (events.length === 0) return;
  getAppState().recordSessionEvents(host, events, extractExternalSessionId(payload));
}

export function handleHook(host: string, event: string, raw: string): string {
  const payload = parsePayload(raw);
  const nudge = rawToolNudge(payload.tool_name);
  const command = shellCommand(payload.tool_input);
  const decision = command ? evaluateCommand(command) : null;

  if (host === 'cursor') {
    if (event === 'pretooluse') {
      if (decision && (decision.decision === 'deny' || decision.decision === 'ask')) {
        return JSON.stringify({
          permission: decision.decision,
          user_message: denyReason(decision),
        });
      }
      return JSON.stringify({ agent_message: nudge ?? '' });
    }
    if (event === 'posttooluse') {
      recordSessionEvents('cursor', payload);
    }
    return JSON.stringify({ additional_context: '' });
  }

  if (host === 'claude') {
    if (event === 'pretooluse') {
      if (decision?.decision === 'deny') {
        return JSON.stringify({ permissionDecision: 'deny', reason: denyReason(decision) });
      }
      if (decision?.decision === 'ask') {
        return JSON.stringify({ permissionDecision: 'ask' });
      }
      return JSON.stringify(nudge ? { additionalContext: nudge } : {});
    }
    if (event === 'posttooluse') {
      recordSessionEvents('claude', payload);
      return JSON.stringify({});
    }
    if (event === 'precompact' || event === 'sessionstart') {
      const snapshot = getAppState().buildSessionResume({
        host: 'claude',
        externalSessionId: extractExternalSessionId(payload),
      });
      return snapshot.text;
    }
    return JSON.stringify({});
  }

  if (host === 'codex' && event === 'sessionstart') {
    const snapshot = getAppState().buildSessionResume({ host: 'codex' });
    return snapshot.text;
  }

  return JSON.stringify({});
}
