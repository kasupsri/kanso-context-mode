import Database from 'better-sqlite3';
import { createHash, randomUUID } from 'crypto';
import { mkdirSync, realpathSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { chunkMarkdown } from '../compression/chunker.js';
import { DEFAULT_CONFIG } from '../config/defaults.js';
import { detectHost, type HostId, type HostInfo } from '../runtime/host.js';
import { type ComparisonBasis, type SessionEventRecord } from '../tools/tool-result.js';
import {
  estimateTokens,
  formatTokenCount,
  resolveTokenProfile,
  type TokenMethod,
} from '../utils/token-estimator.js';
import { HotHandleCache, type HotCacheStats } from './hot-cache.js';

const HANDLE_TOUCH_FLUSH_LIMIT = 64;

export interface ContentHandleRow {
  id: string;
  projectId: string;
  sourcePath: string | null;
  content: string;
  sizeBytes: number;
  createdAt: string;
  expiresAt: string;
  lastAccessedAt: string;
  accessCount: number;
}

export interface ContentHandleSummary {
  id: string;
  sourcePath: string | null;
  sizeBytes: number;
  createdAt: string;
  expiresAt: string;
  lastAccessedAt: string;
  accessCount: number;
}

export interface CompressionEventInput {
  tool: string;
  strategy: string;
  changed: boolean;
  budgetForced: boolean;
  latencyMs: number;
  comparisonBasis?: ComparisonBasis;
  host?: HostId;
  sourceText?: string;
  inputText?: string;
  candidateText?: string;
  outputText: string;
  sourceTokens?: number;
  candidateTokens?: number;
  outputTokens?: number;
  tokenProfile?: string;
  tokenMethod?: TokenMethod;
}

export interface Totals {
  events: number;
  changedEvents: number;
  budgetForcedEvents: number;
  sourceBytes: number;
  candidateBytes: number;
  outputBytes: number;
  sourceTokens: number;
  candidateTokens: number;
  outputTokens: number;
  retrievalSavedBytes: number;
  compressionSavedBytes: number;
  totalSavedBytes: number;
  retrievalSavedTokens: number;
  compressionSavedTokens: number;
  totalSavedTokens: number;
  averageLatencyMs: number;
}

export interface ToolTotals extends Totals {
  tool: string;
}

export interface HostTotals extends Totals {
  host: HostId;
}

export interface KnowledgeStats {
  kbName: string;
  sources: number;
  chunkCount: number;
  sourceBytes: number;
  sourceTokens: number;
}

export interface KnowledgeIndexResult {
  chunksIndexed: number;
  source: string;
  kbName: string;
  sourceBytes: number;
  sourceTokens: number;
}

export interface KnowledgeSearchResult {
  source: string;
  heading: string;
  content: string;
  snippet: string;
  score: number;
  kbName: string;
}

export interface KnowledgeBaseSummary {
  kbName: string;
  sources: number;
  chunkCount: number;
}

export interface TerminalRunInput {
  command: string;
  cwd: string;
  language: string;
  runtime?: string | null;
  exitCode: number;
  timedOut: boolean;
  durationMs: number;
  outputHandleId?: string | null;
  outputText?: string;
  stderrText?: string;
}

export interface TerminalRunRecord {
  id: number;
  sessionId: string;
  command: string;
  cwd: string;
  language: string;
  runtime: string | null;
  exitCode: number;
  timedOut: boolean;
  durationMs: number;
  outputHandleId: string | null;
  outputPreview: string;
  stderrFingerprint: string | null;
  createdAt: string;
}

export interface TerminalRunQuery {
  limit?: number;
  failedOnly?: boolean;
  query?: string;
  cwd?: string;
}

export interface WebSearchCacheInput {
  provider: string;
  queryKey: string;
  queryText: string;
  resultCount: number;
  responseJson: string;
  sourceText: string;
}

export interface WebSearchCacheRecord {
  provider: string;
  queryKey: string;
  queryText: string;
  resultCount: number;
  responseJson: string;
  sourceText: string;
  createdAt: string;
  expiresAt: string;
}

export interface SessionResumeSnapshot {
  host: HostId;
  externalSessionId: string | null;
  text: string;
  eventCount: number;
}

export interface StatsSnapshot {
  generatedAt: string;
  projectRoot: string;
  sessionId: string;
  host: HostId;
  tokenProfile: string;
  tokenMethod: string;
  session: Totals & { byTool: ToolTotals[]; byHost: HostTotals[] };
  today: {
    project: Totals;
    global: Totals;
  };
  allTime: {
    project: Totals;
    global: Totals;
  };
  cache: HotCacheStats;
  sessionContinuity: {
    events: number;
    snapshots: number;
  };
}

type AggregateRow = {
  events: number;
  changed_events: number;
  budget_forced_events: number;
  source_bytes: number;
  candidate_bytes: number;
  output_bytes: number;
  source_tokens_est: number;
  candidate_tokens_est: number;
  output_tokens_est: number;
  retrieval_saved_bytes: number;
  compression_saved_bytes: number;
  total_saved_bytes: number;
  retrieval_saved_tokens_est: number;
  compression_saved_tokens_est: number;
  total_saved_tokens_est: number;
  latency_ms_total: number;
};

type SessionEventRow = SessionEventRecord & {
  host: HostId;
  external_session_id: string | null;
  created_at: string;
};

function nowIso(): string {
  return new Date().toISOString();
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function hashText(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function resolveProjectRoot(): string {
  try {
    return realpathSync.native(process.cwd());
  } catch {
    return process.cwd();
  }
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function toTotals(row: AggregateRow | undefined): Totals {
  const events = Number(row?.events ?? 0);
  return {
    events,
    changedEvents: Number(row?.changed_events ?? 0),
    budgetForcedEvents: Number(row?.budget_forced_events ?? 0),
    sourceBytes: Number(row?.source_bytes ?? 0),
    candidateBytes: Number(row?.candidate_bytes ?? 0),
    outputBytes: Number(row?.output_bytes ?? 0),
    sourceTokens: Number(row?.source_tokens_est ?? 0),
    candidateTokens: Number(row?.candidate_tokens_est ?? 0),
    outputTokens: Number(row?.output_tokens_est ?? 0),
    retrievalSavedBytes: Number(row?.retrieval_saved_bytes ?? 0),
    compressionSavedBytes: Number(row?.compression_saved_bytes ?? 0),
    totalSavedBytes: Number(row?.total_saved_bytes ?? 0),
    retrievalSavedTokens: Number(row?.retrieval_saved_tokens_est ?? 0),
    compressionSavedTokens: Number(row?.compression_saved_tokens_est ?? 0),
    totalSavedTokens: Number(row?.total_saved_tokens_est ?? 0),
    averageLatencyMs: events > 0 ? Math.round(Number(row?.latency_ms_total ?? 0) / events) : 0,
  };
}

function sanitizeSearchQuery(query: string): string {
  const tokens = query
    .toLowerCase()
    .match(/[a-z0-9][a-z0-9._-]*/g)
    ?.flatMap(token => token.split(/[^a-z0-9]+/))
    .map(token => token.trim())
    .filter(token => token.length > 1);

  return [...new Set(tokens ?? [])].map(token => `${token}*`).join(' OR ');
}

function scoreSearchFallback(
  query: string,
  heading: string,
  content: string
): { matchedTokens: number; score: number } {
  const tokens = query
    .toLowerCase()
    .match(/[a-z0-9][a-z0-9._-]*/g)
    ?.flatMap(token => token.split(/[^a-z0-9]+/))
    .map(token => token.trim())
    .filter(token => token.length > 1);
  if (!tokens || tokens.length === 0) {
    return { matchedTokens: 0, score: 0 };
  }

  const haystack = `${heading}\n${content}`.toLowerCase();
  const headingText = heading.toLowerCase();
  let matchedTokens = 0;
  let score = 0;

  for (const token of [...new Set(tokens)]) {
    if (!haystack.includes(token)) continue;
    matchedTokens += 1;
    score += headingText.includes(token) ? 4 : 1;
  }

  return { matchedTokens, score };
}

function buildSnippet(content: string, query: string, size = 220): string {
  const trimmed = content.replace(/\s+/g, ' ').trim();
  if (!trimmed) return '';
  const lower = trimmed.toLowerCase();
  const token = query.trim().toLowerCase().split(/\s+/).find(Boolean);
  if (!token) return trimmed.slice(0, size);
  const index = lower.indexOf(token);
  if (index < 0) return trimmed.slice(0, size);
  const start = Math.max(0, index - Math.floor(size / 3));
  const end = Math.min(trimmed.length, start + size);
  const prefix = start > 0 ? '... ' : '';
  const suffix = end < trimmed.length ? ' ...' : '';
  return `${prefix}${trimmed.slice(start, end)}${suffix}`;
}

function previewText(text: string, maxChars = 280): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, maxChars);
}

function stderrFingerprint(text?: string): string | null {
  const normalized = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!normalized) return null;
  return hashText(normalized).slice(0, 16);
}

function uniqueValues(rows: SessionEventRow[], category: string, limit: number): string[] {
  const seen = new Set<string>();
  const values: string[] = [];
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const row = rows[i];
    if (!row || row.category !== category) continue;
    if (seen.has(row.data)) continue;
    seen.add(row.data);
    values.push(row.data);
    if (values.length >= limit) break;
  }
  return values;
}

export class AppState {
  private readonly db: Database.Database;
  private readonly projectRoot: string;
  private readonly projectId: string;
  private readonly hostInfo: HostInfo;
  private sessionId: string;
  private readonly dbPath: string;
  private readonly hotCache: HotHandleCache<ContentHandleRow>;
  private readonly pendingHandleTouches = new Map<
    string,
    { lastAccessedAt: string; accessCountDelta: number }
  >();
  private pendingHandleTouchCount = 0;
  private writesSinceCleanup = 0;
  private fts5Ready: boolean | null = null;

  constructor() {
    this.projectRoot = resolveProjectRoot();
    this.projectId = hashText(this.projectRoot).slice(0, 16);
    this.hostInfo = detectHost();
    mkdirSync(DEFAULT_CONFIG.storage.stateDir, { recursive: true });
    this.dbPath = join(DEFAULT_CONFIG.storage.stateDir, 'kanso-context-mode.db');
    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('busy_timeout = 5000');
    this.hotCache = new HotHandleCache<ContentHandleRow>({
      maxEntries: DEFAULT_CONFIG.storage.hotCacheEntries,
      maxBytes: DEFAULT_CONFIG.storage.hotCacheMB * 1024 * 1024,
      ttlMs: DEFAULT_CONFIG.storage.hotCacheTtlMs,
    });

    this.initSchema();
    this.ensureProject();
    this.sessionId = this.createSession();
    this.cleanup();
  }

  getProjectRoot(): string {
    return this.projectRoot;
  }

  getProjectId(): string {
    return this.projectId;
  }

  getSessionId(): string {
    return this.sessionId;
  }

  getHostInfo(): HostInfo {
    return this.hostInfo;
  }

  getDbPath(): string {
    return this.dbPath;
  }

  getCacheStats(): HotCacheStats {
    return this.hotCache.stats();
  }

  isFts5Ready(): boolean {
    if (this.fts5Ready !== null) return this.fts5Ready;
    try {
      this.db.exec('CREATE VIRTUAL TABLE IF NOT EXISTS temp.kcm_fts_probe USING fts5(content);');
      this.db.exec('DROP TABLE IF EXISTS temp.kcm_fts_probe;');
      this.fts5Ready = true;
    } catch {
      this.fts5Ready = false;
    }
    return this.fts5Ready;
  }

  saveHandle(content: string, sourcePath?: string): ContentHandleRow {
    const id = `ctx_${hashText(`${this.projectId}:${sourcePath ?? ''}:${content}`).slice(0, 16)}`;
    const createdAt = nowIso();
    const expiresAt = new Date(
      Date.now() + DEFAULT_CONFIG.storage.handleTtlHours * 60 * 60 * 1000
    ).toISOString();
    const sizeBytes = Buffer.byteLength(content, 'utf8');

    this.db
      .prepare(
        `INSERT INTO content_handles (
          id, project_id, source_path, content_hash, content, size_bytes, created_at, expires_at, last_accessed_at, access_count
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
        ON CONFLICT(id) DO UPDATE SET
          source_path = excluded.source_path,
          content_hash = excluded.content_hash,
          content = excluded.content,
          size_bytes = excluded.size_bytes,
          expires_at = excluded.expires_at,
          last_accessed_at = excluded.last_accessed_at`
      )
      .run(
        id,
        this.projectId,
        sourcePath ?? null,
        hashText(content),
        content,
        sizeBytes,
        createdAt,
        expiresAt,
        createdAt
      );

    const row = this.readHandleRow(id) ?? {
      id,
      projectId: this.projectId,
      sourcePath: sourcePath ?? null,
      content,
      sizeBytes,
      createdAt,
      expiresAt,
      lastAccessedAt: createdAt,
      accessCount: 0,
    };
    this.hotCache.put(id, row, row.sizeBytes);
    this.afterWrite();
    return { ...row };
  }

  getHandle(id: string): ContentHandleRow | undefined {
    const cached = this.hotCache.get(id);
    if (cached !== undefined) {
      if (new Date(cached.expiresAt).getTime() < Date.now()) {
        const pending = this.pendingHandleTouches.get(id);
        if (pending) {
          this.pendingHandleTouchCount = Math.max(
            0,
            this.pendingHandleTouchCount - pending.accessCountDelta
          );
          this.pendingHandleTouches.delete(id);
        }
        this.hotCache.delete(id);
        this.db
          .prepare('DELETE FROM content_handles WHERE id = ? AND project_id = ?')
          .run(id, this.projectId);
        this.afterWrite();
        return undefined;
      }
      return this.recordHandleAccess(cached);
    }

    const row = this.readHandleRow(id);
    if (!row) return undefined;
    if (new Date(row.expiresAt).getTime() < Date.now()) {
      this.db.prepare('DELETE FROM content_handles WHERE id = ?').run(id);
      this.afterWrite();
      return undefined;
    }

    this.hotCache.put(id, row, row.sizeBytes);
    return this.recordHandleAccess(row);
  }

  listRecentHandles(limit = 20): ContentHandleRow[] {
    this.flushPendingHandleTouches();
    const safeLimit = Math.max(1, Math.min(limit, 100));
    const rows = this.db
      .prepare(
        `SELECT id, project_id, source_path, content, size_bytes, created_at, expires_at, last_accessed_at, access_count
         FROM content_handles
         WHERE project_id = ?
         ORDER BY last_accessed_at DESC, created_at DESC
         LIMIT ?`
      )
      .all(this.projectId, safeLimit) as Array<{
      id: string;
      project_id: string;
      source_path: string | null;
      content: string;
      size_bytes: number;
      created_at: string;
      expires_at: string;
      last_accessed_at: string;
      access_count: number;
    }>;

    return rows.map(row => ({
      id: row.id,
      projectId: row.project_id,
      sourcePath: row.source_path,
      content: row.content,
      sizeBytes: row.size_bytes,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      lastAccessedAt: row.last_accessed_at,
      accessCount: row.access_count,
    }));
  }

  listRecentHandleSummaries(limit = 20): ContentHandleSummary[] {
    this.flushPendingHandleTouches();
    const safeLimit = Math.max(1, Math.min(limit, 100));
    const rows = this.db
      .prepare(
        `SELECT id, source_path, size_bytes, created_at, expires_at, last_accessed_at, access_count
         FROM content_handles
         WHERE project_id = ?
         ORDER BY last_accessed_at DESC, created_at DESC
         LIMIT ?`
      )
      .all(this.projectId, safeLimit) as Array<{
      id: string;
      source_path: string | null;
      size_bytes: number;
      created_at: string;
      expires_at: string;
      last_accessed_at: string;
      access_count: number;
    }>;

    return rows.map(row => ({
      id: row.id,
      sourcePath: row.source_path,
      sizeBytes: row.size_bytes,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      lastAccessedAt: row.last_accessed_at,
      accessCount: row.access_count,
    }));
  }

  recordCompressionEvent(input: CompressionEventInput): void {
    const candidateText = input.candidateText ?? input.inputText ?? input.outputText;
    const sourceText = input.sourceText ?? candidateText;
    const outputText = input.outputText;

    const candidateBytes = Buffer.byteLength(candidateText, 'utf8');
    const outputBytes = Buffer.byteLength(outputText, 'utf8');
    const candidateTokens = input.candidateTokens ?? estimateTokens(candidateText).tokens;
    const outputTokens = input.outputTokens ?? estimateTokens(outputText).tokens;
    const sourceBytes = Math.max(
      Buffer.byteLength(sourceText, 'utf8'),
      candidateBytes,
      outputBytes
    );
    const sourceTokens = Math.max(
      input.sourceTokens ?? estimateTokens(sourceText).tokens,
      candidateTokens,
      outputTokens
    );
    const retrievalSavedBytes = Math.max(0, sourceBytes - candidateBytes);
    const compressionSavedBytes = Math.max(0, candidateBytes - outputBytes);
    const totalSavedBytes = retrievalSavedBytes + compressionSavedBytes;
    const retrievalSavedTokens = Math.max(0, sourceTokens - candidateTokens);
    const compressionSavedTokens = Math.max(0, candidateTokens - outputTokens);
    const totalSavedTokens = retrievalSavedTokens + compressionSavedTokens;
    const createdAt = nowIso();
    const day = todayKey();
    const host = input.host ?? this.hostInfo.id;
    const comparisonBasis = input.comparisonBasis ?? 'raw_output';
    const resolvedProfile = resolveTokenProfile();
    const tokenProfile = input.tokenProfile ?? resolvedProfile.active;
    const tokenMethod = input.tokenMethod ?? resolvedProfile.method;

    const write = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO compression_events (
            session_id, project_id, host, tool, strategy, changed, budget_forced, latency_ms, comparison_basis,
            source_bytes, candidate_bytes, output_bytes,
            source_tokens_est, candidate_tokens_est, output_tokens_est,
            retrieval_saved_bytes, compression_saved_bytes, total_saved_bytes,
            retrieval_saved_tokens_est, compression_saved_tokens_est, total_saved_tokens_est,
            token_profile, token_method, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          this.sessionId,
          this.projectId,
          host,
          input.tool,
          input.strategy,
          input.changed ? 1 : 0,
          input.budgetForced ? 1 : 0,
          Math.max(0, Math.round(input.latencyMs)),
          comparisonBasis,
          sourceBytes,
          candidateBytes,
          outputBytes,
          sourceTokens,
          candidateTokens,
          outputTokens,
          retrievalSavedBytes,
          compressionSavedBytes,
          totalSavedBytes,
          retrievalSavedTokens,
          compressionSavedTokens,
          totalSavedTokens,
          tokenProfile,
          tokenMethod,
          createdAt
        );

      const upsertRollup = this.db.prepare(
        `INSERT INTO daily_rollups (
          day, scope, scope_id, host, tool, events, changed_events, budget_forced_events,
          source_bytes, candidate_bytes, output_bytes,
          source_tokens_est, candidate_tokens_est, output_tokens_est,
          retrieval_saved_bytes, compression_saved_bytes, total_saved_bytes,
          retrieval_saved_tokens_est, compression_saved_tokens_est, total_saved_tokens_est,
          latency_ms_total
        ) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(day, scope, scope_id, host, tool) DO UPDATE SET
          events = events + 1,
          changed_events = changed_events + excluded.changed_events,
          budget_forced_events = budget_forced_events + excluded.budget_forced_events,
          source_bytes = source_bytes + excluded.source_bytes,
          candidate_bytes = candidate_bytes + excluded.candidate_bytes,
          output_bytes = output_bytes + excluded.output_bytes,
          source_tokens_est = source_tokens_est + excluded.source_tokens_est,
          candidate_tokens_est = candidate_tokens_est + excluded.candidate_tokens_est,
          output_tokens_est = output_tokens_est + excluded.output_tokens_est,
          retrieval_saved_bytes = retrieval_saved_bytes + excluded.retrieval_saved_bytes,
          compression_saved_bytes = compression_saved_bytes + excluded.compression_saved_bytes,
          total_saved_bytes = total_saved_bytes + excluded.total_saved_bytes,
          retrieval_saved_tokens_est = retrieval_saved_tokens_est + excluded.retrieval_saved_tokens_est,
          compression_saved_tokens_est = compression_saved_tokens_est + excluded.compression_saved_tokens_est,
          total_saved_tokens_est = total_saved_tokens_est + excluded.total_saved_tokens_est,
          latency_ms_total = latency_ms_total + excluded.latency_ms_total`
      );

      for (const [scope, scopeId] of [
        ['project', this.projectId],
        ['global', 'global'],
      ] as const) {
        upsertRollup.run(
          day,
          scope,
          scopeId,
          host,
          input.tool,
          input.changed ? 1 : 0,
          input.budgetForced ? 1 : 0,
          sourceBytes,
          candidateBytes,
          outputBytes,
          sourceTokens,
          candidateTokens,
          outputTokens,
          retrievalSavedBytes,
          compressionSavedBytes,
          totalSavedBytes,
          retrievalSavedTokens,
          compressionSavedTokens,
          totalSavedTokens,
          Math.max(0, Math.round(input.latencyMs))
        );
      }
    });

    write();
    this.afterWrite();
  }

  indexKnowledgeText(
    text: string,
    options: { source: string; kbName?: string; chunkSize?: number }
  ): KnowledgeIndexResult {
    if (!this.isFts5Ready()) {
      throw new Error('FTS5 is not available in the local SQLite runtime.');
    }

    const kbName = options.kbName ?? 'default';
    const source = options.source;
    const sourceHash = hashText(text);
    const chunks = chunkMarkdown(
      text,
      options.chunkSize ?? DEFAULT_CONFIG.knowledgeBase.maxChunkSize
    ).filter(chunk => chunk.content.trim().length > 20);
    const sourceBytes = Buffer.byteLength(text, 'utf8');
    const sourceTokens = estimateTokens(text).tokens;

    const write = this.db.transaction(() => {
      const existing = this.db
        .prepare(
          `SELECT id FROM kb_sources
           WHERE project_id = ? AND kb_name = ? AND source_label = ?`
        )
        .get(this.projectId, kbName, source) as { id: number } | undefined;

      if (existing) {
        this.db
          .prepare(
            'DELETE FROM kb_chunks_fts WHERE rowid IN (SELECT id FROM kb_chunks WHERE source_id = ?)'
          )
          .run(existing.id);
        this.db.prepare('DELETE FROM kb_chunks WHERE source_id = ?').run(existing.id);
        this.db.prepare('DELETE FROM kb_sources WHERE id = ?').run(existing.id);
      }

      const insertSource = this.db.prepare(
        `INSERT INTO kb_sources (
          project_id, kb_name, source_label, source_hash, content_bytes, content_tokens_est, chunk_count, indexed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      );
      const sourceInfo = insertSource.run(
        this.projectId,
        kbName,
        source,
        sourceHash,
        sourceBytes,
        sourceTokens,
        chunks.length,
        nowIso()
      );
      const sourceId = Number(sourceInfo.lastInsertRowid);

      const insertChunk = this.db.prepare(
        `INSERT INTO kb_chunks (
          source_id, project_id, kb_name, source_label, heading, content, start_line, end_line
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      );
      const insertFts = this.db.prepare(
        'INSERT INTO kb_chunks_fts (rowid, heading, content) VALUES (?, ?, ?)'
      );

      for (const chunk of chunks) {
        const info = insertChunk.run(
          sourceId,
          this.projectId,
          kbName,
          source,
          chunk.heading,
          chunk.content,
          chunk.startLine,
          chunk.endLine
        );
        insertFts.run(Number(info.lastInsertRowid), chunk.heading, chunk.content);
      }
    });

    write();
    this.afterWrite();

    return {
      chunksIndexed: chunks.length,
      source,
      kbName,
      sourceBytes,
      sourceTokens,
    };
  }

  searchKnowledge(query: string, kbName = 'default', topK = 5): KnowledgeSearchResult[] {
    if (!this.isFts5Ready()) {
      throw new Error('FTS5 is not available in the local SQLite runtime.');
    }

    const sanitized = sanitizeSearchQuery(query);
    if (!sanitized) return [];

    const rows = this.db
      .prepare(
        `SELECT
          kb_chunks.source_label AS source,
          kb_chunks.heading AS heading,
          kb_chunks.content AS content,
          bm25(kb_chunks_fts) AS score
        FROM kb_chunks_fts
        JOIN kb_chunks ON kb_chunks.id = kb_chunks_fts.rowid
        WHERE kb_chunks.project_id = ? AND kb_chunks.kb_name = ? AND kb_chunks_fts MATCH ?
        ORDER BY bm25(kb_chunks_fts)
        LIMIT ?`
      )
      .all(this.projectId, kbName, sanitized, topK) as Array<{
      source: string;
      heading: string;
      content: string;
      score: number;
    }>;

    if (rows.length === 0) {
      const fallbackRows = this.db
        .prepare(
          `SELECT
            source_label AS source,
            heading,
            content
          FROM kb_chunks
          WHERE project_id = ? AND kb_name = ?`
        )
        .all(this.projectId, kbName) as Array<{
        source: string;
        heading: string;
        content: string;
      }>;

      return fallbackRows
        .map(row => {
          const fallback = scoreSearchFallback(query, row.heading, row.content);
          return {
            source: row.source,
            heading: row.heading,
            content: row.content,
            snippet: buildSnippet(row.content, query),
            score: fallback.score,
            kbName,
            matchedTokens: fallback.matchedTokens,
          };
        })
        .filter(row => row.matchedTokens > 0)
        .sort((a, b) => b.score - a.score || a.source.localeCompare(b.source))
        .slice(0, topK)
        .map(({ matchedTokens: _matchedTokens, ...row }) => row);
    }

    return rows.map(row => ({
      source: row.source,
      heading: row.heading,
      content: row.content,
      snippet: buildSnippet(row.content, query),
      score: row.score,
      kbName,
    }));
  }

  getKnowledgeStats(kbName = 'default'): KnowledgeStats {
    const row = this.db
      .prepare(
        `SELECT
          COUNT(*) AS sources,
          COALESCE(SUM(chunk_count), 0) AS chunk_count,
          COALESCE(SUM(content_bytes), 0) AS source_bytes,
          COALESCE(SUM(content_tokens_est), 0) AS source_tokens
        FROM kb_sources
        WHERE project_id = ? AND kb_name = ?`
      )
      .get(this.projectId, kbName) as
      | { sources: number; chunk_count: number; source_bytes: number; source_tokens: number }
      | undefined;

    return {
      kbName,
      sources: Number(row?.sources ?? 0),
      chunkCount: Number(row?.chunk_count ?? 0),
      sourceBytes: Number(row?.source_bytes ?? 0),
      sourceTokens: Number(row?.source_tokens ?? 0),
    };
  }

  listKnowledgeBases(limit = 20): KnowledgeBaseSummary[] {
    const safeLimit = Math.max(1, Math.min(limit, 100));
    const rows = this.db
      .prepare(
        `SELECT
          kb_name,
          COUNT(*) AS sources,
          COALESCE(SUM(chunk_count), 0) AS chunk_count
        FROM kb_sources
        WHERE project_id = ?
        GROUP BY kb_name
        ORDER BY kb_name ASC
        LIMIT ?`
      )
      .all(this.projectId, safeLimit) as Array<{
      kb_name: string;
      sources: number;
      chunk_count: number;
    }>;

    return rows.map(row => ({
      kbName: row.kb_name,
      sources: Number(row.sources ?? 0),
      chunkCount: Number(row.chunk_count ?? 0),
    }));
  }

  recordTerminalRun(input: TerminalRunInput): TerminalRunRecord {
    const createdAt = nowIso();
    const preview = previewText(input.outputText ?? '');
    const fingerprint = stderrFingerprint(input.stderrText);
    const info = this.db
      .prepare(
        `INSERT INTO terminal_runs (
          project_id, session_id, command_text, cwd, language, runtime,
          exit_code, timed_out, duration_ms, output_handle_id, output_preview, stderr_fingerprint, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        this.projectId,
        this.sessionId,
        input.command,
        input.cwd,
        input.language,
        input.runtime ?? null,
        input.exitCode,
        input.timedOut ? 1 : 0,
        Math.max(0, Math.round(input.durationMs)),
        input.outputHandleId ?? null,
        preview,
        fingerprint,
        createdAt
      );
    this.afterWrite();
    return this.getTerminalRun(Number(info.lastInsertRowid))!;
  }

  getTerminalRun(id: number): TerminalRunRecord | undefined {
    const row = this.db
      .prepare(
        `SELECT id, session_id, command_text, cwd, language, runtime,
                exit_code, timed_out, duration_ms, output_handle_id, output_preview, stderr_fingerprint, created_at
         FROM terminal_runs
         WHERE project_id = ? AND id = ?`
      )
      .get(this.projectId, id) as
      | {
          id: number;
          session_id: string;
          command_text: string;
          cwd: string;
          language: string;
          runtime: string | null;
          exit_code: number;
          timed_out: number;
          duration_ms: number;
          output_handle_id: string | null;
          output_preview: string;
          stderr_fingerprint: string | null;
          created_at: string;
        }
      | undefined;

    if (!row) return undefined;
    return {
      id: Number(row.id),
      sessionId: row.session_id,
      command: row.command_text,
      cwd: row.cwd,
      language: row.language,
      runtime: row.runtime,
      exitCode: Number(row.exit_code ?? 0),
      timedOut: Boolean(row.timed_out),
      durationMs: Number(row.duration_ms ?? 0),
      outputHandleId: row.output_handle_id,
      outputPreview: row.output_preview,
      stderrFingerprint: row.stderr_fingerprint,
      createdAt: row.created_at,
    };
  }

  listTerminalRuns(query: TerminalRunQuery = {}): TerminalRunRecord[] {
    const limit = Math.max(1, Math.min(query.limit ?? 20, 100));
    const clauses = ['project_id = ?'];
    const params: Array<string | number> = [this.projectId];

    if (query.failedOnly) {
      clauses.push('(exit_code != 0 OR timed_out = 1)');
    }

    if (query.query?.trim()) {
      clauses.push('(LOWER(command_text) LIKE ? OR LOWER(output_preview) LIKE ?)');
      const pattern = `%${query.query.trim().toLowerCase()}%`;
      params.push(pattern, pattern);
    }

    if (query.cwd?.trim()) {
      clauses.push('LOWER(cwd) LIKE ?');
      params.push(`%${query.cwd.trim().toLowerCase()}%`);
    }

    const rows = this.db
      .prepare(
        `SELECT id, session_id, command_text, cwd, language, runtime,
                exit_code, timed_out, duration_ms, output_handle_id, output_preview, stderr_fingerprint, created_at
         FROM terminal_runs
         WHERE ${clauses.join(' AND ')}
         ORDER BY created_at DESC, id DESC
         LIMIT ?`
      )
      .all(...params, limit) as Array<{
      id: number;
      session_id: string;
      command_text: string;
      cwd: string;
      language: string;
      runtime: string | null;
      exit_code: number;
      timed_out: number;
      duration_ms: number;
      output_handle_id: string | null;
      output_preview: string;
      stderr_fingerprint: string | null;
      created_at: string;
    }>;

    return rows.map(row => ({
      id: Number(row.id),
      sessionId: row.session_id,
      command: row.command_text,
      cwd: row.cwd,
      language: row.language,
      runtime: row.runtime,
      exitCode: Number(row.exit_code ?? 0),
      timedOut: Boolean(row.timed_out),
      durationMs: Number(row.duration_ms ?? 0),
      outputHandleId: row.output_handle_id,
      outputPreview: row.output_preview,
      stderrFingerprint: row.stderr_fingerprint,
      createdAt: row.created_at,
    }));
  }

  getLatestTerminalRuns(limit = 10): TerminalRunRecord[] {
    return this.listTerminalRuns({ limit });
  }

  putWebSearchCache(input: WebSearchCacheInput): void {
    const createdAt = nowIso();
    const expiresAt = new Date(
      Date.now() + DEFAULT_CONFIG.web.cacheTtlHours * 60 * 60 * 1000
    ).toISOString();
    this.db
      .prepare(
        `INSERT INTO web_search_cache (
          project_id, provider, query_key, query_text, result_count, response_json, source_text, created_at, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(project_id, provider, query_key) DO UPDATE SET
          query_text = excluded.query_text,
          result_count = excluded.result_count,
          response_json = excluded.response_json,
          source_text = excluded.source_text,
          created_at = excluded.created_at,
          expires_at = excluded.expires_at`
      )
      .run(
        this.projectId,
        input.provider,
        input.queryKey,
        input.queryText,
        input.resultCount,
        input.responseJson,
        input.sourceText,
        createdAt,
        expiresAt
      );
    this.afterWrite();
  }

  getWebSearchCache(provider: string, queryKey: string): WebSearchCacheRecord | undefined {
    const row = this.db
      .prepare(
        `SELECT provider, query_key, query_text, result_count, response_json, source_text, created_at, expires_at
         FROM web_search_cache
         WHERE project_id = ? AND provider = ? AND query_key = ?`
      )
      .get(this.projectId, provider, queryKey) as
      | {
          provider: string;
          query_key: string;
          query_text: string;
          result_count: number;
          response_json: string;
          source_text: string;
          created_at: string;
          expires_at: string;
        }
      | undefined;

    if (!row) return undefined;
    if (new Date(row.expires_at).getTime() < Date.now()) {
      this.db
        .prepare(
          'DELETE FROM web_search_cache WHERE project_id = ? AND provider = ? AND query_key = ?'
        )
        .run(this.projectId, provider, queryKey);
      this.afterWrite();
      return undefined;
    }

    return {
      provider: row.provider,
      queryKey: row.query_key,
      queryText: row.query_text,
      resultCount: Number(row.result_count ?? 0),
      responseJson: row.response_json,
      sourceText: row.source_text,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    };
  }

  recordSessionEvents(
    host: HostId,
    events: SessionEventRecord[],
    externalSessionId?: string | null
  ): void {
    if (events.length === 0) return;
    const insert = this.db.prepare(
      `INSERT INTO session_events (
        project_id, host, external_session_id, type, category, priority, data, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const createdAt = nowIso();
    const write = this.db.transaction(() => {
      for (const event of events) {
        insert.run(
          this.projectId,
          host,
          externalSessionId ?? null,
          event.type,
          event.category,
          event.priority,
          event.data.slice(0, 2000),
          createdAt
        );
      }
    });
    write();
    this.afterWrite();
  }

  buildSessionResume(
    options: {
      host?: HostId;
      externalSessionId?: string | null;
      maxEvents?: number;
      maxBytes?: number;
    } = {}
  ): SessionResumeSnapshot {
    const host = options.host ?? this.hostInfo.id;
    const externalSessionId = options.externalSessionId ?? this.getLatestExternalSessionId(host);
    const maxEvents = Math.max(
      1,
      Math.min(options.maxEvents ?? DEFAULT_CONFIG.storage.sessionMaxEvents, 200)
    );
    const maxBytes =
      options.maxBytes ?? Math.max(512, DEFAULT_CONFIG.storage.sessionSnapshotBytes ?? 2048);

    const rows = (
      this.db
        .prepare(
          `SELECT host, external_session_id, type, category, priority, data, created_at
         FROM session_events
         WHERE project_id = ? AND host = ? AND (? IS NULL OR external_session_id = ?)
         ORDER BY created_at DESC, id DESC
         LIMIT ?`
        )
        .all(
          this.projectId,
          host,
          externalSessionId,
          externalSessionId,
          maxEvents
        ) as SessionEventRow[]
    ).reverse();

    const activeFiles = uniqueValues(rows, 'file', 8);
    const tasks = uniqueValues(rows, 'task', 6);
    const decisions = uniqueValues(rows, 'decision', 6);
    const errors = uniqueValues(rows, 'error', 5);
    const gitOps = uniqueValues(rows, 'git', 5);
    const commands = uniqueValues(rows, 'command', 6);
    const webLookups = uniqueValues(rows, 'web', 5);
    const recent = rows.slice(-8).map(row => `${row.category}: ${row.data}`);

    const sections = [
      '=== Session Resume ===',
      `host: ${host}`,
      externalSessionId ? `session: ${externalSessionId}` : 'session: latest',
      activeFiles.length > 0 ? `active_files: ${activeFiles.join(' | ')}` : '',
      tasks.length > 0 ? `tasks: ${tasks.join(' | ')}` : '',
      decisions.length > 0 ? `decisions: ${decisions.join(' | ')}` : '',
      errors.length > 0 ? `errors: ${errors.join(' | ')}` : '',
      gitOps.length > 0 ? `git: ${gitOps.join(' | ')}` : '',
      commands.length > 0 ? `commands: ${commands.join(' | ')}` : '',
      webLookups.length > 0 ? `web: ${webLookups.join(' | ')}` : '',
      recent.length > 0 ? `recent: ${recent.join(' || ')}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    let text = sections;
    while (Buffer.byteLength(text, 'utf8') > maxBytes && text.length > 64) {
      text = text.slice(0, Math.floor(text.length * 0.9));
    }

    this.db
      .prepare(
        `INSERT INTO session_snapshots (
          project_id, host, external_session_id, snapshot, event_count, generated_at
        ) VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(this.projectId, host, externalSessionId, text, rows.length, nowIso());
    this.afterWrite();

    return {
      host,
      externalSessionId,
      text,
      eventCount: rows.length,
    };
  }

  getStatsSnapshot(): StatsSnapshot {
    const resolvedProfile = resolveTokenProfile();
    const session = toTotals(
      this.db
        .prepare(
          `SELECT
            COUNT(*) AS events,
            COALESCE(SUM(changed), 0) AS changed_events,
            COALESCE(SUM(budget_forced), 0) AS budget_forced_events,
            COALESCE(SUM(source_bytes), 0) AS source_bytes,
            COALESCE(SUM(candidate_bytes), 0) AS candidate_bytes,
            COALESCE(SUM(output_bytes), 0) AS output_bytes,
            COALESCE(SUM(source_tokens_est), 0) AS source_tokens_est,
            COALESCE(SUM(candidate_tokens_est), 0) AS candidate_tokens_est,
            COALESCE(SUM(output_tokens_est), 0) AS output_tokens_est,
            COALESCE(SUM(retrieval_saved_bytes), 0) AS retrieval_saved_bytes,
            COALESCE(SUM(compression_saved_bytes), 0) AS compression_saved_bytes,
            COALESCE(SUM(total_saved_bytes), 0) AS total_saved_bytes,
            COALESCE(SUM(retrieval_saved_tokens_est), 0) AS retrieval_saved_tokens_est,
            COALESCE(SUM(compression_saved_tokens_est), 0) AS compression_saved_tokens_est,
            COALESCE(SUM(total_saved_tokens_est), 0) AS total_saved_tokens_est,
            COALESCE(SUM(latency_ms), 0) AS latency_ms_total
          FROM compression_events
          WHERE session_id = ?`
        )
        .get(this.sessionId) as AggregateRow
    );

    const byTool = this.db
      .prepare(
        `SELECT
          tool,
          COUNT(*) AS events,
          COALESCE(SUM(changed), 0) AS changed_events,
          COALESCE(SUM(budget_forced), 0) AS budget_forced_events,
          COALESCE(SUM(source_bytes), 0) AS source_bytes,
          COALESCE(SUM(candidate_bytes), 0) AS candidate_bytes,
          COALESCE(SUM(output_bytes), 0) AS output_bytes,
          COALESCE(SUM(source_tokens_est), 0) AS source_tokens_est,
          COALESCE(SUM(candidate_tokens_est), 0) AS candidate_tokens_est,
          COALESCE(SUM(output_tokens_est), 0) AS output_tokens_est,
          COALESCE(SUM(retrieval_saved_bytes), 0) AS retrieval_saved_bytes,
          COALESCE(SUM(compression_saved_bytes), 0) AS compression_saved_bytes,
          COALESCE(SUM(total_saved_bytes), 0) AS total_saved_bytes,
          COALESCE(SUM(retrieval_saved_tokens_est), 0) AS retrieval_saved_tokens_est,
          COALESCE(SUM(compression_saved_tokens_est), 0) AS compression_saved_tokens_est,
          COALESCE(SUM(total_saved_tokens_est), 0) AS total_saved_tokens_est,
          COALESCE(SUM(latency_ms), 0) AS latency_ms_total
        FROM compression_events
        WHERE session_id = ?
        GROUP BY tool
        ORDER BY total_saved_tokens_est DESC, tool ASC`
      )
      .all(this.sessionId) as Array<AggregateRow & { tool: string }>;

    const byHost = this.db
      .prepare(
        `SELECT
          host,
          COUNT(*) AS events,
          COALESCE(SUM(changed), 0) AS changed_events,
          COALESCE(SUM(budget_forced), 0) AS budget_forced_events,
          COALESCE(SUM(source_bytes), 0) AS source_bytes,
          COALESCE(SUM(candidate_bytes), 0) AS candidate_bytes,
          COALESCE(SUM(output_bytes), 0) AS output_bytes,
          COALESCE(SUM(source_tokens_est), 0) AS source_tokens_est,
          COALESCE(SUM(candidate_tokens_est), 0) AS candidate_tokens_est,
          COALESCE(SUM(output_tokens_est), 0) AS output_tokens_est,
          COALESCE(SUM(retrieval_saved_bytes), 0) AS retrieval_saved_bytes,
          COALESCE(SUM(compression_saved_bytes), 0) AS compression_saved_bytes,
          COALESCE(SUM(total_saved_bytes), 0) AS total_saved_bytes,
          COALESCE(SUM(retrieval_saved_tokens_est), 0) AS retrieval_saved_tokens_est,
          COALESCE(SUM(compression_saved_tokens_est), 0) AS compression_saved_tokens_est,
          COALESCE(SUM(total_saved_tokens_est), 0) AS total_saved_tokens_est,
          COALESCE(SUM(latency_ms), 0) AS latency_ms_total
        FROM compression_events
        WHERE session_id = ?
        GROUP BY host
        ORDER BY total_saved_tokens_est DESC, host ASC`
      )
      .all(this.sessionId) as Array<AggregateRow & { host: HostId }>;

    const rollupQuery = this.db.prepare(
      `SELECT
        COALESCE(SUM(events), 0) AS events,
        COALESCE(SUM(changed_events), 0) AS changed_events,
        COALESCE(SUM(budget_forced_events), 0) AS budget_forced_events,
        COALESCE(SUM(source_bytes), 0) AS source_bytes,
        COALESCE(SUM(candidate_bytes), 0) AS candidate_bytes,
        COALESCE(SUM(output_bytes), 0) AS output_bytes,
        COALESCE(SUM(source_tokens_est), 0) AS source_tokens_est,
        COALESCE(SUM(candidate_tokens_est), 0) AS candidate_tokens_est,
        COALESCE(SUM(output_tokens_est), 0) AS output_tokens_est,
        COALESCE(SUM(retrieval_saved_bytes), 0) AS retrieval_saved_bytes,
        COALESCE(SUM(compression_saved_bytes), 0) AS compression_saved_bytes,
        COALESCE(SUM(total_saved_bytes), 0) AS total_saved_bytes,
        COALESCE(SUM(retrieval_saved_tokens_est), 0) AS retrieval_saved_tokens_est,
        COALESCE(SUM(compression_saved_tokens_est), 0) AS compression_saved_tokens_est,
        COALESCE(SUM(total_saved_tokens_est), 0) AS total_saved_tokens_est,
        COALESCE(SUM(latency_ms_total), 0) AS latency_ms_total
      FROM daily_rollups
      WHERE scope = ? AND scope_id = ? AND (? = '' OR day = ?)`
    );

    const continuity = this.db
      .prepare(
        `SELECT
          (SELECT COUNT(*) FROM session_events WHERE project_id = ?) AS events,
          (SELECT COUNT(*) FROM session_snapshots WHERE project_id = ?) AS snapshots`
      )
      .get(this.projectId, this.projectId) as { events: number; snapshots: number };

    return {
      generatedAt: nowIso(),
      projectRoot: this.projectRoot,
      sessionId: this.sessionId,
      host: this.hostInfo.id,
      tokenProfile: resolvedProfile.active,
      tokenMethod: resolvedProfile.method,
      session: {
        ...session,
        byTool: byTool.map(row => ({ tool: row.tool, ...toTotals(row) })),
        byHost: byHost.map(row => ({ host: row.host, ...toTotals(row) })),
      },
      today: {
        project: toTotals(
          rollupQuery.get('project', this.projectId, todayKey(), todayKey()) as AggregateRow
        ),
        global: toTotals(
          rollupQuery.get('global', 'global', todayKey(), todayKey()) as AggregateRow
        ),
      },
      allTime: {
        project: toTotals(rollupQuery.get('project', this.projectId, '', '') as AggregateRow),
        global: toTotals(rollupQuery.get('global', 'global', '', '') as AggregateRow),
      },
      cache: this.hotCache.stats(),
      sessionContinuity: {
        events: Number(continuity.events ?? 0),
        snapshots: Number(continuity.snapshots ?? 0),
      },
    };
  }

  formatStatsReport(responseMode: 'minimal' | 'full'): string {
    const snapshot = this.getStatsSnapshot();
    if (responseMode === 'minimal') {
      return [
        'stats_report',
        `host=${snapshot.host}`,
        `saved_tok=${snapshot.session.totalSavedTokens}`,
        `retrieval_tok=${snapshot.session.retrievalSavedTokens}`,
        `compression_tok=${snapshot.session.compressionSavedTokens}`,
        `today_tok=${snapshot.today.project.totalSavedTokens}`,
        `all_time_tok=${snapshot.allTime.project.totalSavedTokens}`,
        `profile=${snapshot.tokenProfile}`,
        `method=${snapshot.tokenMethod}`,
      ].join(' ');
    }

    const renderWindow = (label: string, totals: Totals): string[] => [
      label,
      `  Events:              ${totals.events}`,
      `  Source:              ${formatTokenCount(totals.sourceTokens)} (${formatBytes(totals.sourceBytes)})`,
      `  Candidate:           ${formatTokenCount(totals.candidateTokens)} (${formatBytes(totals.candidateBytes)})`,
      `  Output:              ${formatTokenCount(totals.outputTokens)} (${formatBytes(totals.outputBytes)})`,
      `  Retrieval saved:     ${formatTokenCount(totals.retrievalSavedTokens)} (${formatBytes(totals.retrievalSavedBytes)})`,
      `  Compression saved:   ${formatTokenCount(totals.compressionSavedTokens)} (${formatBytes(totals.compressionSavedBytes)})`,
      `  Total saved:         ${formatTokenCount(totals.totalSavedTokens)} (${formatBytes(totals.totalSavedBytes)})`,
      `  Changed:             ${totals.changedEvents}`,
      `  Budget forced:       ${totals.budgetForcedEvents}`,
      `  Avg latency:         ${totals.averageLatencyMs}ms`,
    ];

    const lines = [
      '=== Kanso Context Mode Stats Report ===',
      `Project root: ${snapshot.projectRoot}`,
      `Session: ${snapshot.sessionId}`,
      `Resolved host: ${snapshot.host}`,
      `Token estimator: ${snapshot.tokenProfile} (${snapshot.tokenMethod})`,
      'All token counts below are estimated.',
      '',
      ...renderWindow('SESSION', snapshot.session),
      '',
      'BY TOOL',
      ...snapshot.session.byTool.map(tool => {
        const pct =
          tool.sourceTokens > 0
            ? ((tool.totalSavedTokens / tool.sourceTokens) * 100).toFixed(0)
            : '0';
        return `  ${tool.tool.padEnd(18)} ${formatTokenCount(tool.totalSavedTokens).padStart(12)} saved  ${pct.padStart(3)}%  ${tool.events} event${tool.events === 1 ? '' : 's'}`;
      }),
      '',
      'BY HOST',
      ...snapshot.session.byHost.map(host => {
        const pct =
          host.sourceTokens > 0
            ? ((host.totalSavedTokens / host.sourceTokens) * 100).toFixed(0)
            : '0';
        return `  ${host.host.padEnd(18)} ${formatTokenCount(host.totalSavedTokens).padStart(12)} saved  ${pct.padStart(3)}%  ${host.events} event${host.events === 1 ? '' : 's'}`;
      }),
      '',
      ...renderWindow('TODAY (PROJECT)', snapshot.today.project),
      '',
      ...renderWindow('TODAY (GLOBAL)', snapshot.today.global),
      '',
      ...renderWindow('ALL TIME (PROJECT)', snapshot.allTime.project),
      '',
      ...renderWindow('ALL TIME (GLOBAL)', snapshot.allTime.global),
      '',
      'SESSION CONTINUITY',
      `  Events stored:    ${snapshot.sessionContinuity.events}`,
      `  Snapshots stored: ${snapshot.sessionContinuity.snapshots}`,
      '',
      'HOT CACHE',
      `  Entries: ${snapshot.cache.entries}/${snapshot.cache.maxEntries}`,
      `  Memory:  ${formatBytes(snapshot.cache.bytes)} / ${formatBytes(snapshot.cache.maxBytes)}`,
      `  TTL:     ${Math.round(snapshot.cache.ttlMs / 1000)}s`,
      `  Hits:    ${snapshot.cache.hits}`,
      `  Misses:  ${snapshot.cache.misses}`,
    ];

    return lines.join('\n');
  }

  exportStats(targetPath?: string): string {
    const outputPath =
      targetPath ??
      DEFAULT_CONFIG.stats.exportPath ??
      join(DEFAULT_CONFIG.storage.stateDir, `stats-${Date.now()}.json`);
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, JSON.stringify(this.getStatsSnapshot(), null, 2), 'utf8');
    return outputPath;
  }

  resetSession(): string {
    this.flushPendingHandleTouches();
    this.db.prepare('UPDATE sessions SET ended_at = ? WHERE id = ?').run(nowIso(), this.sessionId);
    this.sessionId = this.createSession();
    this.hotCache.clear();
    this.pendingHandleTouches.clear();
    this.pendingHandleTouchCount = 0;
    return this.sessionId;
  }

  close(): void {
    this.flushPendingHandleTouches();
    this.db.close();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        root_path TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        host TEXT NOT NULL,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        FOREIGN KEY(project_id) REFERENCES projects(id)
      );

      CREATE TABLE IF NOT EXISTS content_handles (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        source_path TEXT,
        content_hash TEXT NOT NULL,
        content TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        last_accessed_at TEXT NOT NULL,
        access_count INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY(project_id) REFERENCES projects(id)
      );

      CREATE TABLE IF NOT EXISTS compression_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        host TEXT NOT NULL,
        tool TEXT NOT NULL,
        strategy TEXT NOT NULL,
        changed INTEGER NOT NULL,
        budget_forced INTEGER NOT NULL,
        latency_ms INTEGER NOT NULL,
        comparison_basis TEXT NOT NULL,
        source_bytes INTEGER NOT NULL,
        candidate_bytes INTEGER NOT NULL,
        output_bytes INTEGER NOT NULL,
        source_tokens_est INTEGER NOT NULL,
        candidate_tokens_est INTEGER NOT NULL,
        output_tokens_est INTEGER NOT NULL,
        retrieval_saved_bytes INTEGER NOT NULL,
        compression_saved_bytes INTEGER NOT NULL,
        total_saved_bytes INTEGER NOT NULL,
        retrieval_saved_tokens_est INTEGER NOT NULL,
        compression_saved_tokens_est INTEGER NOT NULL,
        total_saved_tokens_est INTEGER NOT NULL,
        token_profile TEXT NOT NULL,
        token_method TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(session_id) REFERENCES sessions(id),
        FOREIGN KEY(project_id) REFERENCES projects(id)
      );

      CREATE TABLE IF NOT EXISTS daily_rollups (
        day TEXT NOT NULL,
        scope TEXT NOT NULL,
        scope_id TEXT NOT NULL,
        host TEXT NOT NULL,
        tool TEXT NOT NULL,
        events INTEGER NOT NULL,
        changed_events INTEGER NOT NULL,
        budget_forced_events INTEGER NOT NULL,
        source_bytes INTEGER NOT NULL,
        candidate_bytes INTEGER NOT NULL,
        output_bytes INTEGER NOT NULL,
        source_tokens_est INTEGER NOT NULL,
        candidate_tokens_est INTEGER NOT NULL,
        output_tokens_est INTEGER NOT NULL,
        retrieval_saved_bytes INTEGER NOT NULL,
        compression_saved_bytes INTEGER NOT NULL,
        total_saved_bytes INTEGER NOT NULL,
        retrieval_saved_tokens_est INTEGER NOT NULL,
        compression_saved_tokens_est INTEGER NOT NULL,
        total_saved_tokens_est INTEGER NOT NULL,
        latency_ms_total INTEGER NOT NULL,
        PRIMARY KEY(day, scope, scope_id, host, tool)
      );

      CREATE TABLE IF NOT EXISTS session_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id TEXT NOT NULL,
        host TEXT NOT NULL,
        external_session_id TEXT,
        type TEXT NOT NULL,
        category TEXT NOT NULL,
        priority INTEGER NOT NULL DEFAULT 3,
        data TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(project_id) REFERENCES projects(id)
      );

      CREATE TABLE IF NOT EXISTS session_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id TEXT NOT NULL,
        host TEXT NOT NULL,
        external_session_id TEXT,
        snapshot TEXT NOT NULL,
        event_count INTEGER NOT NULL,
        generated_at TEXT NOT NULL,
        FOREIGN KEY(project_id) REFERENCES projects(id)
      );

      CREATE TABLE IF NOT EXISTS terminal_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        command_text TEXT NOT NULL,
        cwd TEXT NOT NULL,
        language TEXT NOT NULL,
        runtime TEXT,
        exit_code INTEGER NOT NULL,
        timed_out INTEGER NOT NULL,
        duration_ms INTEGER NOT NULL,
        output_handle_id TEXT,
        output_preview TEXT NOT NULL,
        stderr_fingerprint TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY(project_id) REFERENCES projects(id),
        FOREIGN KEY(session_id) REFERENCES sessions(id)
      );

      CREATE TABLE IF NOT EXISTS kb_sources (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id TEXT NOT NULL,
        kb_name TEXT NOT NULL,
        source_label TEXT NOT NULL,
        source_hash TEXT NOT NULL,
        content_bytes INTEGER NOT NULL,
        content_tokens_est INTEGER NOT NULL,
        chunk_count INTEGER NOT NULL,
        indexed_at TEXT NOT NULL,
        UNIQUE(project_id, kb_name, source_label),
        FOREIGN KEY(project_id) REFERENCES projects(id)
      );

      CREATE TABLE IF NOT EXISTS kb_chunks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_id INTEGER NOT NULL,
        project_id TEXT NOT NULL,
        kb_name TEXT NOT NULL,
        source_label TEXT NOT NULL,
        heading TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL,
        start_line INTEGER NOT NULL DEFAULT 0,
        end_line INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY(source_id) REFERENCES kb_sources(id) ON DELETE CASCADE,
        FOREIGN KEY(project_id) REFERENCES projects(id)
      );

      CREATE TABLE IF NOT EXISTS web_search_cache (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        query_key TEXT NOT NULL,
        query_text TEXT NOT NULL,
        result_count INTEGER NOT NULL,
        response_json TEXT NOT NULL,
        source_text TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        UNIQUE(project_id, provider, query_key),
        FOREIGN KEY(project_id) REFERENCES projects(id)
      );
    `);

    if (this.isFts5Ready()) {
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS kb_chunks_fts USING fts5(
          heading,
          content
        );
      `);
    }

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_handles_project_expires ON content_handles(project_id, expires_at);
      CREATE INDEX IF NOT EXISTS idx_events_session ON compression_events(session_id);
      CREATE INDEX IF NOT EXISTS idx_events_project_created ON compression_events(project_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_rollups_scope ON daily_rollups(scope, scope_id, day);
      CREATE INDEX IF NOT EXISTS idx_session_events_lookup ON session_events(project_id, host, external_session_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_terminal_runs_lookup ON terminal_runs(project_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_terminal_runs_session ON terminal_runs(session_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_kb_sources_lookup ON kb_sources(project_id, kb_name, source_label);
      CREATE INDEX IF NOT EXISTS idx_kb_chunks_lookup ON kb_chunks(project_id, kb_name, source_id);
      CREATE INDEX IF NOT EXISTS idx_web_search_cache_lookup ON web_search_cache(project_id, provider, expires_at);
    `);
  }

  private ensureProject(): void {
    const timestamp = nowIso();
    this.db
      .prepare(
        `INSERT INTO projects (id, root_path, created_at, last_seen_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET last_seen_at = excluded.last_seen_at, root_path = excluded.root_path`
      )
      .run(this.projectId, this.projectRoot, timestamp, timestamp);
  }

  private createSession(): string {
    const id = randomUUID();
    this.db
      .prepare('INSERT INTO sessions (id, project_id, host, started_at) VALUES (?, ?, ?, ?)')
      .run(id, this.projectId, this.hostInfo.id, nowIso());
    return id;
  }

  listExternalSessionIds(host: HostId, limit = 10): string[] {
    const safeLimit = Math.max(1, Math.min(limit, 50));
    const rows = this.db
      .prepare(
        `SELECT DISTINCT external_session_id
         FROM session_events
         WHERE project_id = ? AND host = ? AND external_session_id IS NOT NULL
         ORDER BY external_session_id DESC
         LIMIT ?`
      )
      .all(this.projectId, host, safeLimit) as Array<{ external_session_id: string | null }>;
    return rows
      .map(row => row.external_session_id)
      .filter((value): value is string => Boolean(value));
  }

  listRecentSessionValues(category: string, limit = 10): string[] {
    const safeLimit = Math.max(1, Math.min(limit, 100));
    const rows = this.db
      .prepare(
        `SELECT data
         FROM session_events
         WHERE project_id = ? AND category = ?
         ORDER BY created_at DESC, id DESC
         LIMIT ?`
      )
      .all(this.projectId, category, safeLimit * 3) as Array<{ data: string }>;
    const values: string[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
      if (!row.data || seen.has(row.data)) continue;
      seen.add(row.data);
      values.push(row.data);
      if (values.length >= safeLimit) break;
    }
    return values;
  }

  private getLatestExternalSessionId(host: HostId): string | null {
    const row = this.db
      .prepare(
        `SELECT external_session_id
         FROM session_events
         WHERE project_id = ? AND host = ? AND external_session_id IS NOT NULL
         ORDER BY created_at DESC, id DESC
         LIMIT 1`
      )
      .get(this.projectId, host) as { external_session_id: string | null } | undefined;
    return row?.external_session_id ?? null;
  }

  private readHandleRow(id: string): ContentHandleRow | undefined {
    const row = this.db
      .prepare(
        `SELECT id, project_id, source_path, content, size_bytes, created_at, expires_at, last_accessed_at, access_count
         FROM content_handles WHERE id = ? AND project_id = ?`
      )
      .get(id, this.projectId) as
      | {
          id: string;
          project_id: string;
          source_path: string | null;
          content: string;
          size_bytes: number;
          created_at: string;
          expires_at: string;
          last_accessed_at: string;
          access_count: number;
        }
      | undefined;

    if (!row) return undefined;
    return {
      id: row.id,
      projectId: row.project_id,
      sourcePath: row.source_path,
      content: row.content,
      sizeBytes: row.size_bytes,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      lastAccessedAt: row.last_accessed_at,
      accessCount: row.access_count,
    };
  }

  private recordHandleAccess(handle: ContentHandleRow): ContentHandleRow {
    const accessedAt = nowIso();
    handle.lastAccessedAt = accessedAt;
    handle.accessCount += 1;

    const pending = this.pendingHandleTouches.get(handle.id);
    if (pending) {
      pending.lastAccessedAt = accessedAt;
      pending.accessCountDelta += 1;
    } else {
      this.pendingHandleTouches.set(handle.id, {
        lastAccessedAt: accessedAt,
        accessCountDelta: 1,
      });
    }

    this.pendingHandleTouchCount += 1;
    if (this.pendingHandleTouchCount >= HANDLE_TOUCH_FLUSH_LIMIT) {
      this.flushPendingHandleTouches();
    }

    return { ...handle };
  }

  private flushPendingHandleTouches(): void {
    if (this.pendingHandleTouches.size === 0) return;
    const update = this.db.prepare(
      'UPDATE content_handles SET last_accessed_at = ?, access_count = access_count + ? WHERE id = ? AND project_id = ?'
    );
    const flush = this.db.transaction(
      (entries: Array<[string, { lastAccessedAt: string; accessCountDelta: number }]>) => {
        for (const [id, touch] of entries) {
          update.run(touch.lastAccessedAt, touch.accessCountDelta, id, this.projectId);
        }
      }
    );
    flush([...this.pendingHandleTouches.entries()]);
    this.pendingHandleTouches.clear();
    this.pendingHandleTouchCount = 0;
  }

  private afterWrite(): void {
    this.writesSinceCleanup += 1;
    if (this.writesSinceCleanup < DEFAULT_CONFIG.storage.cleanupEveryWrites) return;
    this.writesSinceCleanup = 0;
    this.flushPendingHandleTouches();
    this.cleanup();
  }

  private cleanup(): void {
    const now = nowIso();
    const cutoff = new Date(
      Date.now() - DEFAULT_CONFIG.storage.eventRetentionDays * 24 * 60 * 60 * 1000
    ).toISOString();
    this.db.prepare('DELETE FROM content_handles WHERE expires_at < ?').run(now);
    this.db.prepare('DELETE FROM compression_events WHERE created_at < ?').run(cutoff);
    this.db.prepare('DELETE FROM session_events WHERE created_at < ?').run(cutoff);
    this.db.prepare('DELETE FROM session_snapshots WHERE generated_at < ?').run(cutoff);
    this.db.prepare('DELETE FROM terminal_runs WHERE created_at < ?').run(cutoff);
    this.db.prepare('DELETE FROM web_search_cache WHERE expires_at < ?').run(now);
  }
}
