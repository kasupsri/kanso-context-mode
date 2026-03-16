import { readFile, stat } from 'fs/promises';
import { DEFAULT_CONFIG } from '../config/defaults.js';
import { getAppState } from '../state/index.js';
import { evaluateFilePath } from '../security/policy.js';

export interface LoadedSource {
  sourceLabel: string;
  content: string;
  contextId: string;
  fromHandle: boolean;
}

export async function loadPathOrHandle(
  input: { path?: string; context_id?: string },
  purpose: string
): Promise<LoadedSource | string> {
  const state = getAppState();

  if (input.context_id) {
    const handle = state.getHandle(input.context_id);
    if (!handle) {
      return `Error: unknown or expired context_id "${input.context_id}"`;
    }
    return {
      sourceLabel: handle.sourcePath ?? `context:${handle.id}`,
      content: handle.content,
      contextId: handle.id,
      fromHandle: true,
    };
  }

  if (!input.path?.trim()) {
    return `Error: ${purpose} requires "path" or "context_id"`;
  }

  const denied = evaluateFilePath(input.path);
  if (denied.denied) {
    return `Blocked by security policy: file path matches "${denied.matchedPattern}"`;
  }

  let fileStats;
  try {
    fileStats = await stat(input.path);
  } catch (err) {
    return `Error reading file "${input.path}": ${String(err)}`;
  }

  if (!fileStats.isFile()) {
    return `Error reading file "${input.path}": path is not a regular file`;
  }

  if (fileStats.size > DEFAULT_CONFIG.sandbox.maxFileBytes) {
    return [
      `Error reading file "${input.path}": file is too large for ${purpose}.`,
      `Size: ${fileStats.size} bytes, limit: ${DEFAULT_CONFIG.sandbox.maxFileBytes} bytes.`,
    ].join('\n');
  }

  let content: string;
  try {
    content = await readFile(input.path, 'utf8');
  } catch (err) {
    return `Error reading file "${input.path}": ${String(err)}`;
  }

  const handle = state.saveHandle(content, input.path);
  return {
    sourceLabel: input.path,
    content,
    contextId: handle.id,
    fromHandle: false,
  };
}
