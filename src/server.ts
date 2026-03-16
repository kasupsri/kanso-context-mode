import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  CompleteRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { type CompressionStrategy } from './compression/strategies.js';
import { optimizeResponse } from './compression/response-optimizer.js';
import { DEFAULT_CONFIG, type ResponseMode } from './config/defaults.js';
import {
  buildPromptMessages,
  completePromptArgument,
  listPromptDefinitions,
} from './prompts/index.js';
import {
  completeResourceUri,
  listKansoResourceTemplates,
  listKansoResources,
  readKansoResource,
} from './resources/registry.js';
import { getAppState } from './state/index.js';
import { compressTool } from './tools/compress.js';
import { diagnosticsFocusTool } from './tools/diagnostics-focus.js';
import { doctorTool } from './tools/doctor.js';
import { editTargetsTool } from './tools/edit-targets.js';
import { executeFileTool } from './tools/execute-file.js';
import { executeTool } from './tools/execute.js';
import { fetchAndIndexTool } from './tools/fetch-and-index.js';
import { gitFocusTool } from './tools/git-focus.js';
import { indexContentTool } from './tools/index-content.js';
import { readFileTool } from './tools/read-file.js';
import { readReferencesTool } from './tools/read-references.js';
import { readSymbolsTool } from './tools/read-symbols.js';
import { rewritePreviewTool } from './tools/rewrite-preview.js';
import { runFocusTool } from './tools/run-focus.js';
import { searchTool } from './tools/search.js';
import { sessionResumeTool } from './tools/session-resume.js';
import { statsExportTool } from './tools/stats-export.js';
import { statsReportTool } from './tools/stats-report.js';
import { statsResetTool } from './tools/stats-reset.js';
import { structureSearchTool } from './tools/structure-search.js';
import { terminalHistoryTool } from './tools/terminal-history.js';
import { treeFocusTool } from './tools/tree-focus.js';
import { type ComparisonBasis, type ToolExecutionResult } from './tools/tool-result.js';
import { webSearchTool } from './tools/web-search.js';
import { workspaceSearchTool } from './tools/workspace-search.js';
import { logger } from './utils/logger.js';
import { APP_VERSION } from './version.js';

interface ToolSchema {
  properties?: Record<string, Record<string, unknown>>;
  required?: string[];
}

const RESPONSE_MODES: ReadonlySet<ResponseMode> = new Set(['minimal', 'full']);
const OPTIMIZATION_STRATEGIES: ReadonlySet<CompressionStrategy> = new Set([
  'auto',
  'truncate',
  'summarize',
  'filter',
  'ultra',
  'as-is',
]);
const NON_TRACKED_TOOLS = new Set(['stats_report', 'stats_export', 'stats_reset', 'doctor']);
const ULTRA_FIRST_TOOLS = new Set([
  'read_file',
  'read_symbols',
  'read_references',
  'diagnostics_focus',
  'git_focus',
  'workspace_search',
  'terminal_history',
  'run_focus',
  'stats_report',
  'doctor',
]);
const COMPARISON_BASIS_BY_TOOL: Record<string, ComparisonBasis> = {
  compress: 'raw_output',
  diagnostics_focus: 'raw_log',
  edit_targets: 'workspace_source',
  execute: 'raw_output',
  execute_file: 'raw_output',
  fetch_and_index: 'indexed_source',
  git_focus: 'raw_diff',
  index: 'indexed_source',
  read_file: 'full_file',
  read_references: 'full_file',
  read_symbols: 'full_file',
  rewrite_preview: 'workspace_source',
  run_focus: 'terminal_run_output',
  search: 'indexed_source',
  session_resume: 'session_snapshot_source',
  structure_search: 'workspace_source',
  terminal_history: 'terminal_run_output',
  tree_focus: 'workspace_source',
  web_search: 'web_search_source',
  workspace_search: 'workspace_source',
};

const TOOLS: Tool[] = [
  {
    name: 'index',
    description: 'Index local or inline content into the local knowledge base.',
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string' },
        path: { type: 'string' },
        source: { type: 'string' },
        kb_name: { type: 'string' },
        chunk_size: { type: 'number' },
        max_output_tokens: { type: 'number' },
      },
    },
  },
  {
    name: 'search',
    description: 'Query the local knowledge base with compact exact snippets.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        kb_name: { type: 'string' },
        top_k: { type: 'number' },
        compact: { type: 'boolean' },
        max_output_tokens: { type: 'number' },
      },
      required: ['query'],
    },
  },
  {
    name: 'workspace_search',
    description: 'Search the workspace with ripgrep-first retrieval and compact grouped snippets.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        root_path: { type: 'string' },
        glob: { type: 'string' },
        max_matches: { type: 'number' },
        context_lines: { type: 'number' },
        case_sensitive: { type: 'boolean' },
        whole_word: { type: 'boolean' },
        include_line_numbers: { type: 'boolean' },
        return_context_id: { type: 'boolean' },
        max_output_tokens: { type: 'number' },
      },
      required: ['query'],
    },
  },
  {
    name: 'tree_focus',
    description: 'Return a bounded directory tree summary optimized for repo exploration.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        depth: { type: 'number' },
        max_entries: { type: 'number' },
        include_hidden: { type: 'boolean' },
        glob: { type: 'string' },
        max_output_tokens: { type: 'number' },
      },
    },
  },
  {
    name: 'fetch_and_index',
    description: 'Fetch public documentation or text content, convert it, and index it locally.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string' },
        urls: { type: 'array' },
        kb_name: { type: 'string' },
        chunk_size: { type: 'number' },
        max_output_tokens: { type: 'number' },
      },
    },
  },
  {
    name: 'compress',
    description: 'Compress large content with deterministic, token-budgeted strategies.',
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string' },
        intent: { type: 'string' },
        strategy: { type: 'string', enum: ['auto', 'truncate', 'summarize', 'filter', 'ultra'] },
        max_output_tokens: { type: 'number' },
      },
      required: ['content'],
    },
  },
  {
    name: 'execute',
    description: 'Execute code in a sandboxed subprocess and return token-efficient output.',
    inputSchema: {
      type: 'object',
      properties: {
        language: {
          type: 'string',
          enum: [
            'javascript',
            'js',
            'typescript',
            'ts',
            'python',
            'py',
            'shell',
            'powershell',
            'cmd',
            'bash',
            'sh',
            'ruby',
            'rb',
            'go',
            'rust',
            'rs',
            'php',
            'perl',
            'pl',
            'r',
          ],
        },
        code: { type: 'string' },
        intent: { type: 'string' },
        timeout: { type: 'number' },
        max_output_tokens: { type: 'number' },
        return_context_id: { type: 'boolean' },
        record_session: { type: 'boolean' },
        shell_runtime: {
          type: 'string',
          enum: ['auto', 'powershell', 'cmd', 'git-bash', 'bash', 'zsh', 'sh'],
        },
      },
      required: ['language', 'code'],
    },
  },
  {
    name: 'execute_file',
    description:
      'Process a file in a sandboxed JavaScript runtime without dumping raw file text into context.',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string' },
        code: { type: 'string' },
        intent: { type: 'string' },
        timeout: { type: 'number' },
        max_output_tokens: { type: 'number' },
        return_context_id: { type: 'boolean' },
        record_session: { type: 'boolean' },
      },
      required: ['file_path', 'code'],
    },
  },
  {
    name: 'read_file',
    description:
      'Retrieve focused file content by query, range, or cursor using disk-backed context handles.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        context_id: { type: 'string' },
        start_line: { type: 'number' },
        end_line: { type: 'number' },
        query: { type: 'string' },
        context_lines: { type: 'number' },
        max_matches: { type: 'number' },
        include_line_numbers: { type: 'boolean' },
        cursor: { type: 'number' },
        page_lines: { type: 'number' },
        return_context_id: { type: 'boolean' },
        max_output_tokens: { type: 'number' },
      },
    },
  },
  {
    name: 'read_symbols',
    description: 'Return a compact symbol inventory for a source file.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        query: { type: 'string' },
        kind: {
          type: 'string',
          enum: [
            'all',
            'function',
            'class',
            'interface',
            'type',
            'enum',
            'const',
            'method',
            'struct',
            'trait',
          ],
        },
        max_symbols: { type: 'number' },
        include_line_numbers: { type: 'boolean' },
        max_output_tokens: { type: 'number' },
      },
      required: ['path'],
    },
  },
  {
    name: 'read_references',
    description: 'Return symbol-focused snippets from a file path or disk-backed context handle.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        context_id: { type: 'string' },
        symbol: { type: 'string' },
        context_lines: { type: 'number' },
        max_matches: { type: 'number' },
        include_line_numbers: { type: 'boolean' },
        case_sensitive: { type: 'boolean' },
        whole_word: { type: 'boolean' },
        max_output_tokens: { type: 'number' },
      },
      required: ['symbol'],
    },
  },
  {
    name: 'git_focus',
    description: 'Summarize changed files, changed symbols, and minimal hunks from git diff.',
    inputSchema: {
      type: 'object',
      properties: {
        repo_path: { type: 'string' },
        base_ref: { type: 'string' },
        scope: { type: 'string', enum: ['working', 'staged', 'unstaged'] },
        max_files: { type: 'number' },
        max_hunks_per_file: { type: 'number' },
        include_hunks: { type: 'boolean' },
        max_output_tokens: { type: 'number' },
      },
    },
  },
  {
    name: 'diagnostics_focus',
    description:
      'Normalize noisy compiler, lint, or test logs into concise action-oriented diagnostics.',
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string' },
        format: { type: 'string', enum: ['auto', 'tsc', 'eslint', 'vitest', 'jest', 'generic'] },
        max_items: { type: 'number' },
        include_examples: { type: 'boolean' },
        max_output_tokens: { type: 'number' },
      },
      required: ['content'],
    },
  },
  {
    name: 'structure_search',
    description: 'Use ast-grep for syntax-aware search when the CLI is available.',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string' },
        path: { type: 'string' },
        language: { type: 'string' },
        max_matches: { type: 'number' },
        max_output_tokens: { type: 'number' },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'rewrite_preview',
    description: 'Preview structural rewrites with ast-grep without mutating files.',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string' },
        rewrite: { type: 'string' },
        path: { type: 'string' },
        language: { type: 'string' },
        max_matches: { type: 'number' },
        max_output_tokens: { type: 'number' },
      },
      required: ['pattern', 'rewrite'],
    },
  },
  {
    name: 'web_search',
    description:
      'Query a configured web provider and return compact results plus reusable context.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        domains: { type: 'array' },
        result_limit: { type: 'number' },
        recency_days: { type: 'number' },
        kind: { type: 'string', enum: ['general', 'docs', 'code', 'news'] },
        provider: { type: 'string', enum: ['off', 'brave_context', 'firecrawl_search', 'exa'] },
        max_output_tokens: { type: 'number' },
      },
      required: ['query'],
    },
  },
  {
    name: 'terminal_history',
    description: 'List recorded terminal runs with reusable run/context links.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number' },
        failed_only: { type: 'boolean' },
        query: { type: 'string' },
        cwd: { type: 'string' },
        with_output_handles: { type: 'boolean' },
        max_output_tokens: { type: 'number' },
      },
    },
  },
  {
    name: 'run_focus',
    description: 'Inspect one recorded run without replaying the original command.',
    inputSchema: {
      type: 'object',
      properties: {
        run_id: { type: 'number' },
        max_output_tokens: { type: 'number' },
      },
      required: ['run_id'],
    },
  },
  {
    name: 'session_resume',
    description: 'Return a compact project/session resume snapshot for the current host.',
    inputSchema: {
      type: 'object',
      properties: {
        host: { type: 'string', enum: ['claude', 'cursor', 'codex', 'generic'] },
        session_id: { type: 'string' },
        max_events: { type: 'number' },
        max_output_tokens: { type: 'number' },
      },
    },
  },
  {
    name: 'edit_targets',
    description: 'Rank likely files and line ranges for a requested coding task.',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string' },
        paths: { type: 'array' },
        max_files: { type: 'number' },
        include_symbols: { type: 'boolean' },
        include_references: { type: 'boolean' },
        max_output_tokens: { type: 'number' },
      },
      required: ['task'],
    },
  },
  {
    name: 'stats_report',
    description:
      'Show estimated token savings for the session, today, project all-time, and global all-time.',
    inputSchema: {
      type: 'object',
      properties: {
        max_output_tokens: { type: 'number' },
      },
    },
  },
  {
    name: 'stats_export',
    description: 'Export durable token-savings statistics to JSON.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        max_output_tokens: { type: 'number' },
      },
    },
  },
  {
    name: 'stats_reset',
    description: 'Reset the current session window while preserving historical savings.',
    inputSchema: {
      type: 'object',
      properties: {
        max_output_tokens: { type: 'number' },
      },
    },
  },
  {
    name: 'doctor',
    description:
      'Run diagnostics for shell resolution, safety policy, token profile, and local state.',
    inputSchema: {
      type: 'object',
      properties: {
        max_output_tokens: { type: 'number' },
      },
    },
  },
];

for (const tool of TOOLS) {
  const schema = tool.inputSchema as ToolSchema;
  schema.properties = schema.properties ?? {};
  schema.properties['max_output_tokens'] = schema.properties['max_output_tokens'] ?? {
    type: 'number',
  };
  schema.properties['response_mode'] = { type: 'string', enum: ['minimal', 'full'] };
}

function asObject(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return {};
  }
  return input as Record<string, unknown>;
}

function normalizeResponseMode(value: unknown): ResponseMode {
  return typeof value === 'string' && RESPONSE_MODES.has(value as ResponseMode)
    ? (value as ResponseMode)
    : DEFAULT_CONFIG.compression.responseMode;
}

function resolveMaxOutputTokens(value: unknown): number {
  const requested =
    typeof value === 'number' && Number.isFinite(value) && value > 0
      ? Math.floor(value)
      : DEFAULT_CONFIG.compression.defaultMaxOutputTokens;
  return Math.max(1, Math.min(requested, DEFAULT_CONFIG.compression.hardMaxOutputTokens));
}

function normalizeStrategy(value: unknown): CompressionStrategy | undefined {
  if (typeof value !== 'string') return undefined;
  return OPTIMIZATION_STRATEGIES.has(value as CompressionStrategy)
    ? (value as CompressionStrategy)
    : undefined;
}

function preferredStrategy(
  toolName: string,
  parsed: Record<string, unknown>
): CompressionStrategy | undefined {
  const explicit = normalizeStrategy(parsed['strategy']);
  if (explicit && explicit !== 'auto') return explicit;
  return ULTRA_FIRST_TOOLS.has(toolName) ? 'ultra' : undefined;
}

function shouldTrack(toolName: string): boolean {
  return !NON_TRACKED_TOOLS.has(toolName);
}

async function runTool(
  toolName: string,
  args: Record<string, unknown>
): Promise<string | ToolExecutionResult> {
  switch (toolName) {
    case 'index':
      return await indexContentTool(args as unknown as Parameters<typeof indexContentTool>[0]);
    case 'search':
      return await searchTool(args as unknown as Parameters<typeof searchTool>[0]);
    case 'workspace_search':
      return await workspaceSearchTool(
        args as unknown as Parameters<typeof workspaceSearchTool>[0]
      );
    case 'tree_focus':
      return await treeFocusTool(args as unknown as Parameters<typeof treeFocusTool>[0]);
    case 'fetch_and_index':
      return await fetchAndIndexTool(args as unknown as Parameters<typeof fetchAndIndexTool>[0]);
    case 'compress':
      return compressTool(args as unknown as Parameters<typeof compressTool>[0]);
    case 'execute':
      return await executeTool(args as unknown as Parameters<typeof executeTool>[0]);
    case 'execute_file':
      return await executeFileTool(args as unknown as Parameters<typeof executeFileTool>[0]);
    case 'read_file':
      return await readFileTool(args as unknown as Parameters<typeof readFileTool>[0]);
    case 'read_symbols':
      return await readSymbolsTool(args as unknown as Parameters<typeof readSymbolsTool>[0]);
    case 'read_references':
      return await readReferencesTool(args as unknown as Parameters<typeof readReferencesTool>[0]);
    case 'git_focus':
      return await gitFocusTool(args as unknown as Parameters<typeof gitFocusTool>[0]);
    case 'diagnostics_focus':
      return diagnosticsFocusTool(args as unknown as Parameters<typeof diagnosticsFocusTool>[0]);
    case 'structure_search':
      return structureSearchTool(args as unknown as Parameters<typeof structureSearchTool>[0]);
    case 'rewrite_preview':
      return rewritePreviewTool(args as unknown as Parameters<typeof rewritePreviewTool>[0]);
    case 'web_search':
      return await webSearchTool(args as unknown as Parameters<typeof webSearchTool>[0]);
    case 'terminal_history':
      return terminalHistoryTool(args as unknown as Parameters<typeof terminalHistoryTool>[0]);
    case 'run_focus':
      return runFocusTool(args as unknown as Parameters<typeof runFocusTool>[0]);
    case 'session_resume':
      return sessionResumeTool(args as unknown as Parameters<typeof sessionResumeTool>[0]);
    case 'edit_targets':
      return await editTargetsTool(args as unknown as Parameters<typeof editTargetsTool>[0]);
    case 'stats_report':
      return statsReportTool(args as unknown as Parameters<typeof statsReportTool>[0]);
    case 'stats_export':
      return statsExportTool(args as unknown as Parameters<typeof statsExportTool>[0]);
    case 'stats_reset':
      return statsResetTool(args as unknown as Parameters<typeof statsResetTool>[0]);
    case 'doctor':
      return doctorTool(args as unknown as Parameters<typeof doctorTool>[0]);
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

function defaultComparisonBasis(toolName: string): ComparisonBasis {
  return COMPARISON_BASIS_BY_TOOL[toolName] ?? 'raw_output';
}

function normalizeToolExecutionResult(
  toolName: string,
  rawResult: string | ToolExecutionResult
): ToolExecutionResult {
  if (typeof rawResult === 'string') {
    return {
      text: rawResult,
      candidateText: rawResult,
      comparisonBasis: defaultComparisonBasis(toolName),
    };
  }

  return {
    candidateText: rawResult.text,
    comparisonBasis: defaultComparisonBasis(toolName),
    ...rawResult,
  };
}

export function createServer() {
  getAppState();

  const server = new Server(
    {
      name: 'kanso-context-mode',
      version: APP_VERSION,
    },
    {
      capabilities: {
        completions: {},
        prompts: {
          listChanged: true,
        },
        resources: {
          listChanged: true,
        },
        tools: {
          listChanged: true,
        },
      },
    }
  );

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: listKansoResources(),
  }));

  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
    resourceTemplates: listKansoResourceTemplates(),
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async request =>
    readKansoResource(request.params.uri)
  );

  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: listPromptDefinitions().map(prompt => ({
      name: prompt.name,
      title: prompt.title,
      description: prompt.description,
      arguments: prompt.arguments,
    })),
  }));

  server.setRequestHandler(GetPromptRequestSchema, async request => {
    const prompt = listPromptDefinitions().find(item => item.name === request.params.name);
    if (!prompt) {
      throw new Error(`Unknown prompt: ${request.params.name}`);
    }

    return {
      description: prompt.description,
      messages: buildPromptMessages(request.params.name, request.params.arguments ?? {}),
    };
  });

  server.setRequestHandler(CompleteRequestSchema, async request => {
    const values =
      request.params.ref.type === 'ref/resource'
        ? completeResourceUri(
            request.params.ref.uri,
            request.params.argument.name,
            request.params.argument.value
          )
        : completePromptArgument(
            request.params.ref.name,
            request.params.argument.name,
            request.params.argument.value
          );
    const limited = [...new Set(values)].slice(0, 100);
    return {
      completion: {
        values: limited,
        total: limited.length,
        hasMore: false,
      },
    };
  });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async request => {
    const toolName = request.params.name;
    const parsed = asObject(request.params.arguments);
    const responseMode = normalizeResponseMode(parsed['response_mode']);
    const maxOutputTokens = resolveMaxOutputTokens(parsed['max_output_tokens']);
    parsed['response_mode'] = responseMode;
    parsed['max_output_tokens'] = maxOutputTokens;

    const start = Date.now();
    try {
      const toolResult = normalizeToolExecutionResult(toolName, await runTool(toolName, parsed));
      const rawText = toolResult.candidateText ?? toolResult.text;

      let outputText = rawText;
      let chosenStrategy: CompressionStrategy = 'as-is';
      let budgetForced = false;
      let changed = false;
      let candidateTokens: number | undefined;
      let outputTokens: number | undefined;

      if (toolName !== 'stats_reset') {
        const optimized = optimizeResponse(rawText, {
          intent: typeof parsed['intent'] === 'string' ? parsed['intent'] : undefined,
          maxOutputTokens,
          preferredStrategy: preferredStrategy(toolName, parsed),
          toolName,
          isError: false,
          responseMode,
        });
        outputText = optimized.output;
        chosenStrategy = optimized.chosenStrategy;
        budgetForced = optimized.budgetForced;
        changed = optimized.changed;
        candidateTokens = optimized.inputTokens;
        outputTokens = optimized.outputTokens;
      }

      if (shouldTrack(toolName)) {
        if (toolResult.sessionEvents && toolResult.sessionEvents.length > 0) {
          getAppState().recordSessionEvents(
            toolResult.host ?? getAppState().getHostInfo().id,
            toolResult.sessionEvents,
            toolResult.externalSessionId
          );
        }
        getAppState().recordCompressionEvent({
          tool: toolName,
          strategy: chosenStrategy,
          changed,
          budgetForced,
          latencyMs: Date.now() - start,
          sourceText: toolResult.sourceText,
          candidateText: rawText,
          outputText,
          candidateTokens,
          outputTokens,
          comparisonBasis: toolResult.comparisonBasis ?? defaultComparisonBasis(toolName),
        });
      }

      const resourceLinks = toolResult.resourceLinks ?? [];
      return {
        content: [
          { type: 'text', text: outputText || 'ok' },
          ...resourceLinks.map(link => ({ ...link })),
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Tool execution failed', { toolName, error: message });
      return {
        content: [{ type: 'text', text: `Error: ${message}` }],
        isError: true,
      };
    }
  });

  const transport = new StdioServerTransport();
  return { server, transport };
}
