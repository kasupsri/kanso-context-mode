import { readFile, stat } from 'fs/promises';
import { DEFAULT_CONFIG, type ResponseMode } from '../config/defaults.js';
import { getAppState } from '../state/index.js';
import { evaluateFilePath } from '../security/policy.js';
import { asToolResult, type ToolExecutionResult } from './tool-result.js';

export interface IndexContentToolInput {
  content?: string;
  path?: string;
  source?: string;
  kb_name?: string;
  chunk_size?: number;
  max_output_tokens?: number;
  response_mode?: ResponseMode;
}

export function resolveIndexSourceLabel(input: IndexContentToolInput): string {
  if (input.source?.trim()) return input.source.trim();
  if (input.path?.trim()) return input.path.trim();
  return 'inline';
}

async function loadIndexContent(input: IndexContentToolInput): Promise<string> {
  if (input.content && input.path) {
    throw new Error('index accepts either "content" or "path", not both.');
  }

  if (input.content) return input.content;
  if (!input.path?.trim()) {
    throw new Error('index requires "content" or "path".');
  }

  const denied = evaluateFilePath(input.path);
  if (denied.denied) {
    throw new Error(`Blocked by security policy: file path matches "${denied.matchedPattern}"`);
  }

  const fileStats = await stat(input.path);
  if (!fileStats.isFile()) {
    throw new Error(`"${input.path}" is not a regular file.`);
  }
  if (fileStats.size > DEFAULT_CONFIG.sandbox.maxFileBytes) {
    throw new Error(
      `File is too large for indexing (${fileStats.size} bytes > ${DEFAULT_CONFIG.sandbox.maxFileBytes} bytes).`
    );
  }

  return readFile(input.path, 'utf8');
}

export async function indexContentTool(input: IndexContentToolInput): Promise<ToolExecutionResult> {
  const content = await loadIndexContent(input);
  const kbName = input.kb_name ?? 'default';
  const source = resolveIndexSourceLabel(input);
  const chunkSize =
    typeof input.chunk_size === 'number' &&
    Number.isFinite(input.chunk_size) &&
    input.chunk_size > 0
      ? Math.floor(input.chunk_size)
      : DEFAULT_CONFIG.knowledgeBase.maxChunkSize;
  const result = getAppState().indexKnowledgeText(content, {
    source,
    kbName,
    chunkSize,
  });
  const stats = getAppState().getKnowledgeStats(kbName);
  const responseMode = input.response_mode ?? DEFAULT_CONFIG.compression.responseMode;

  const text =
    responseMode === 'full'
      ? [
          '=== Knowledge Index ===',
          `kb: ${kbName}`,
          `source: ${source}`,
          `chunks_indexed: ${result.chunksIndexed}`,
          `source_bytes: ${result.sourceBytes}`,
          `source_tokens_est: ${result.sourceTokens}`,
          `kb_sources: ${stats.sources}`,
          `kb_chunks: ${stats.chunkCount}`,
        ].join('\n')
      : `ok:index kb=${kbName} source=${source} chunks=${result.chunksIndexed} total_sources=${stats.sources} total_chunks=${stats.chunkCount}`;

  return asToolResult(text, {
    sourceText: content,
    candidateText: text,
    comparisonBasis: 'indexed_source',
  });
}
