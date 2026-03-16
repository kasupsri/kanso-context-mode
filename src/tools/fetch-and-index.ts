import { DEFAULT_CONFIG } from '../config/defaults.js';
import { type ResponseMode } from '../config/defaults.js';
import { lookup } from 'dns/promises';
import { isIP } from 'net';
import { getAppState } from '../state/index.js';
import { asToolResult, type ToolExecutionResult } from './tool-result.js';
import { APP_VERSION } from '../version.js';

export interface FetchAndIndexToolInput {
  url: string;
  kb_name?: string;
  chunk_size?: number;
  max_output_tokens?: number;
  response_mode?: ResponseMode;
}

function parseAndValidateUrl(raw: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`Invalid URL: "${raw}"`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Unsupported URL protocol "${parsed.protocol}". Only http/https are allowed.`);
  }

  if (parsed.username || parsed.password) {
    throw new Error('URLs containing embedded credentials are not allowed.');
  }

  return parsed;
}

function isPrivateIPv4(address: string): boolean {
  const parts = address.split('.').map(part => Number.parseInt(part, 10));
  if (parts.length !== 4 || parts.some(part => Number.isNaN(part) || part < 0 || part > 255)) {
    return false;
  }

  const a = parts[0] ?? -1;
  const b = parts[1] ?? -1;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

function isPrivateIPv6(address: string): boolean {
  const normalized = address.toLowerCase();
  if (normalized === '::1' || normalized === '::') return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true; // ULA fc00::/7
  if (/^fe[89ab]/.test(normalized)) return true; // Link-local fe80::/10
  return false;
}

function isPrivateIp(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isPrivateIPv4(address);
  if (family === 6) return isPrivateIPv6(address);
  return false;
}

async function assertPublicFetchTarget(url: URL): Promise<void> {
  if (DEFAULT_CONFIG.security.allowPrivateNetworkFetch) {
    return;
  }

  const hostname = url.hostname.toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.local')) {
    throw new Error(`Refusing to fetch local/private host "${url.hostname}"`);
  }

  if (isPrivateIp(hostname)) {
    throw new Error(`Refusing to fetch private IP address "${url.hostname}"`);
  }

  if (isIP(hostname)) {
    return;
  }

  const resolved = await lookup(hostname, { all: true, verbatim: true });
  if (resolved.length === 0) {
    throw new Error(`Unable to resolve host "${url.hostname}"`);
  }

  for (const record of resolved) {
    if (isPrivateIp(record.address)) {
      throw new Error(
        `Refusing to fetch private-network target "${url.hostname}" (${record.address})`
      );
    }
  }
}

function isTextContentType(contentType: string): boolean {
  const normalized = contentType.toLowerCase();
  return (
    normalized.startsWith('text/') ||
    normalized.includes('json') ||
    normalized.includes('xml') ||
    normalized.includes('javascript') ||
    normalized.includes('x-www-form-urlencoded')
  );
}

async function readResponseTextWithLimit(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) {
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > maxBytes) {
      throw new Error(`Fetched response exceeds size limit (${maxBytes} bytes).`);
    }
    return text;
  }

  const reader = response.body.getReader() as {
    read: () => Promise<{ done: boolean; value?: Uint8Array }>;
  };
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let totalBytes = 0;

  let done = false;
  while (!done) {
    const readResult = await reader.read();
    done = readResult.done;
    const value = readResult.value;
    if (value) {
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        throw new Error(`Fetched response exceeds size limit (${maxBytes} bytes).`);
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
  }

  chunks.push(decoder.decode());
  return chunks.join('');
}

async function fetchAndConvertToMarkdown(url: string): Promise<string> {
  const parsed = parseAndValidateUrl(url);
  await assertPublicFetchTarget(parsed);

  // Use the built-in fetch available in supported Node runtimes.
  const response = await fetch(parsed, {
    headers: {
      'User-Agent': `kanso-context-mode/${APP_VERSION} (MCP Server)`,
      Accept: 'text/html,application/xhtml+xml,text/plain',
    },
    signal: AbortSignal.timeout(15_000),
  });

  const finalUrl = parseAndValidateUrl(response.url || parsed.toString());
  await assertPublicFetchTarget(finalUrl);

  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status} ${response.statusText} fetching ${finalUrl.toString()}`
    );
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (!isTextContentType(contentType)) {
    throw new Error(`Unsupported content type "${contentType}"`);
  }

  const bodyText = await readResponseTextWithLimit(
    response,
    DEFAULT_CONFIG.knowledgeBase.maxFetchBytes
  );

  if (
    contentType.includes('text/plain') ||
    contentType.includes('text/markdown') ||
    contentType.includes('application/json') ||
    contentType.includes('application/xml') ||
    contentType.includes('text/xml')
  ) {
    return bodyText;
  }

  // Convert HTML to Markdown using turndown (no JSDOM dependency)
  try {
    const imported = (await import('turndown')) as {
      default: new (options?: unknown) => { turndown: (input: string) => string };
    };
    const TurndownService = imported.default;
    const turndown = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
      bulletListMarker: '-',
    });
    return turndown.turndown(bodyText);
  } catch {
    // Basic HTML stripping fallback
    return bodyText
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
}

export async function fetchAndIndexTool(
  input: FetchAndIndexToolInput
): Promise<ToolExecutionResult> {
  const { url, kb_name = 'default', chunk_size } = input;
  const chunkSize =
    typeof chunk_size === 'number' && Number.isFinite(chunk_size) && chunk_size > 0
      ? Math.floor(chunk_size)
      : DEFAULT_CONFIG.knowledgeBase.maxChunkSize;

  let markdown: string;
  try {
    markdown = await fetchAndConvertToMarkdown(url);
  } catch (err) {
    return asToolResult(`Error fetching "${url}": ${String(err)}`, {
      candidateText: `Error fetching "${url}": ${String(err)}`,
    });
  }

  const result = getAppState().indexKnowledgeText(markdown, {
    source: url,
    kbName: kb_name,
    chunkSize,
  });
  const stats = getAppState().getKnowledgeStats(kb_name);
  const wordCount = markdown.split(/\s+/).length;

  const responseMode = input.response_mode ?? DEFAULT_CONFIG.compression.responseMode;
  const text =
    responseMode === 'full'
      ? [
          `Fetched and indexed "${url}"`,
          `Content: ~${wordCount.toLocaleString()} words converted to ${result.chunksIndexed} searchable chunks.`,
          `Knowledge base "${kb_name}": ${stats.chunkCount} total chunks from ${stats.sources} source(s).`,
          `Use search to query: search({ query: "your question", kb_name: "${kb_name}" })`,
        ].join('\n')
      : `ok:fetch_index chunks=${result.chunksIndexed} words=${wordCount} kb=${kb_name} total=${stats.chunkCount} srcs=${stats.sources}`;

  return asToolResult(text, {
    sourceText: markdown,
    candidateText: text,
    comparisonBasis: 'indexed_source',
  });
}
