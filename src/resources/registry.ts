import type { HostId } from '../runtime/host.js';
import { getAppState } from '../state/index.js';
import type { ToolResourceLink } from '../tools/tool-result.js';

const TEXT_MIME = 'text/plain';

export interface ListedResource {
  uri: string;
  name: string;
  title?: string;
  description?: string;
  mimeType?: string;
}

export interface ListedResourceTemplate extends ListedResource {
  uriTemplate: string;
}

export function buildContextUri(contextId: string): string {
  return `context://${contextId}`;
}

export function buildRunUri(runId: number): string {
  return `run://${runId}`;
}

export function buildSessionUri(host: HostId, sessionId = 'latest'): string {
  return `session://${host}/${encodeURIComponent(sessionId)}`;
}

export function buildKbUri(kbName: string): string {
  return `kb://${encodeURIComponent(kbName)}`;
}

export function contextResourceLink(contextId: string, sourceLabel?: string): ToolResourceLink {
  return {
    type: 'resource_link',
    uri: buildContextUri(contextId),
    name: `context:${contextId}`,
    title: 'Context Handle',
    description: sourceLabel ? `Disk-backed context from ${sourceLabel}` : 'Disk-backed context',
    mimeType: TEXT_MIME,
  };
}

export function runResourceLink(runId: number, command: string): ToolResourceLink {
  return {
    type: 'resource_link',
    uri: buildRunUri(runId),
    name: `run:${runId}`,
    title: 'Terminal Run',
    description: command.slice(0, 120),
    mimeType: TEXT_MIME,
  };
}

export function sessionResourceLink(host: HostId, sessionId = 'latest'): ToolResourceLink {
  return {
    type: 'resource_link',
    uri: buildSessionUri(host, sessionId),
    name: `session:${host}:${sessionId}`,
    title: 'Session Resume',
    description: `Resume snapshot for ${host}`,
    mimeType: TEXT_MIME,
  };
}

export function kbResourceLink(kbName: string): ToolResourceLink {
  return {
    type: 'resource_link',
    uri: buildKbUri(kbName),
    name: `kb:${kbName}`,
    title: 'Knowledge Base',
    description: `Knowledge base ${kbName}`,
    mimeType: TEXT_MIME,
  };
}

export function listKansoResources(limit = 8): ListedResource[] {
  const state = getAppState();
  const handles = state.listRecentHandleSummaries(limit).map(handle => ({
    uri: buildContextUri(handle.id),
    name: `context:${handle.id}`,
    title: 'Context Handle',
    description: handle.sourcePath ?? 'Saved context handle',
    mimeType: TEXT_MIME,
  }));
  const runs = state.getLatestTerminalRuns(limit).map(run => ({
    uri: buildRunUri(run.id),
    name: `run:${run.id}`,
    title: 'Terminal Run',
    description: run.command.slice(0, 120),
    mimeType: TEXT_MIME,
  }));
  const kbs = state.listKnowledgeBases(limit).map(kb => ({
    uri: buildKbUri(kb.kbName),
    name: `kb:${kb.kbName}`,
    title: 'Knowledge Base',
    description: `${kb.sources} source(s), ${kb.chunkCount} chunk(s)`,
    mimeType: TEXT_MIME,
  }));

  const sessions = (['claude', 'cursor', 'codex', 'generic'] as HostId[]).map(host => ({
    uri: buildSessionUri(host),
    name: `session:${host}`,
    title: 'Session Resume',
    description: `Latest session snapshot for ${host}`,
    mimeType: TEXT_MIME,
  }));

  return [...handles, ...runs, ...kbs, ...sessions].slice(0, limit * 4);
}

export function listKansoResourceTemplates(): ListedResourceTemplate[] {
  return [
    {
      uriTemplate: 'context://{context_id}',
      uri: 'context://{context_id}',
      name: 'context-template',
      title: 'Context Handle',
      description: 'Read a saved context handle by id.',
      mimeType: TEXT_MIME,
    },
    {
      uriTemplate: 'run://{run_id}',
      uri: 'run://{run_id}',
      name: 'run-template',
      title: 'Terminal Run',
      description: 'Read a recorded terminal run by id.',
      mimeType: TEXT_MIME,
    },
    {
      uriTemplate: 'session://{host}/{session_id}',
      uri: 'session://{host}/{session_id}',
      name: 'session-template',
      title: 'Session Resume',
      description: 'Read a host/session resume snapshot.',
      mimeType: TEXT_MIME,
    },
    {
      uriTemplate: 'kb://{kb_name}',
      uri: 'kb://{kb_name}',
      name: 'kb-template',
      title: 'Knowledge Base',
      description: 'Read a knowledge-base summary.',
      mimeType: TEXT_MIME,
    },
  ];
}

function decodeHost(value: string): string {
  return decodeURIComponent(value);
}

function decodePathSegment(value: string): string {
  return decodeURIComponent(value.replace(/^\/+/, ''));
}

export function completeResourceUri(
  uri: string,
  argumentName: string,
  currentValue: string
): string[] {
  const state = getAppState();
  const prefix = currentValue.trim();

  if (uri.startsWith('context://') || argumentName === 'context_id') {
    return state
      .listRecentHandleSummaries(20)
      .map(handle => handle.id)
      .filter(id => id.startsWith(prefix));
  }

  if (uri.startsWith('run://') || argumentName === 'run_id') {
    return state
      .getLatestTerminalRuns(20)
      .map(run => String(run.id))
      .filter(id => id.startsWith(prefix));
  }

  if (uri.startsWith('session://') || argumentName === 'session_id') {
    const parts = uri.replace('session://', '').split('/');
    const host = (parts[0] || 'generic') as HostId;
    return ['latest', ...state.listExternalSessionIds(host, 20)].filter(value =>
      value.startsWith(prefix)
    );
  }

  if (uri.startsWith('kb://') || argumentName === 'kb_name') {
    return state
      .listKnowledgeBases(20)
      .map(kb => kb.kbName)
      .filter(name => name.startsWith(prefix));
  }

  if (argumentName === 'host') {
    return ['claude', 'cursor', 'codex', 'generic'].filter(value => value.startsWith(prefix));
  }

  return [];
}

export function readKansoResource(uri: string): {
  contents: Array<{ uri: string; mimeType: string; text: string }>;
} {
  const state = getAppState();
  const parsed = new URL(uri);

  if (parsed.protocol === 'context:') {
    const handle = state.getHandle(decodeHost(parsed.host));
    if (!handle) {
      throw new Error(`Unknown context resource "${uri}"`);
    }
    const text = [
      '=== Context Resource ===',
      `context_id: ${handle.id}`,
      `source: ${handle.sourcePath ?? 'inline'}`,
      `bytes: ${handle.sizeBytes}`,
      '',
      handle.content,
    ].join('\n');
    return { contents: [{ uri, mimeType: TEXT_MIME, text }] };
  }

  if (parsed.protocol === 'run:') {
    const runId = Number.parseInt(decodeHost(parsed.host), 10);
    const run = state.getTerminalRun(runId);
    if (!run) {
      throw new Error(`Unknown run resource "${uri}"`);
    }
    const outputHandle = run.outputHandleId ? state.getHandle(run.outputHandleId) : undefined;
    const handleText = outputHandle?.content ?? run.outputPreview;
    const text = [
      '=== Run Resource ===',
      `run_id: ${run.id}`,
      `command: ${run.command}`,
      `cwd: ${run.cwd}`,
      `language: ${run.language}`,
      `runtime: ${run.runtime ?? 'n/a'}`,
      `exit_code: ${run.exitCode}`,
      `timed_out: ${run.timedOut ? 'yes' : 'no'}`,
      `duration_ms: ${run.durationMs}`,
      `output_handle_id: ${run.outputHandleId ?? 'n/a'}`,
      '',
      handleText,
    ].join('\n');
    return { contents: [{ uri, mimeType: TEXT_MIME, text }] };
  }

  if (parsed.protocol === 'session:') {
    const host = decodeHost(parsed.host) as HostId;
    const sessionId = decodePathSegment(parsed.pathname || '/latest') || 'latest';
    const snapshot = state.buildSessionResume({
      host,
      externalSessionId: sessionId === 'latest' ? null : sessionId,
    });
    return { contents: [{ uri, mimeType: TEXT_MIME, text: snapshot.text }] };
  }

  if (parsed.protocol === 'kb:') {
    const kbName = decodeHost(parsed.host);
    const stats = state.getKnowledgeStats(kbName);
    const text = [
      '=== Knowledge Base Resource ===',
      `kb: ${kbName}`,
      `sources: ${stats.sources}`,
      `chunks: ${stats.chunkCount}`,
      `source_bytes: ${stats.sourceBytes}`,
      `source_tokens_est: ${stats.sourceTokens}`,
    ].join('\n');
    return { contents: [{ uri, mimeType: TEXT_MIME, text }] };
  }

  throw new Error(`Unsupported resource URI "${uri}"`);
}
