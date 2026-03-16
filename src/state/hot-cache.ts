interface HotCacheEntry {
  id: string;
  content: string;
  bytes: number;
  expiresAt: number;
}

export interface HotCacheStats {
  enabled: boolean;
  entries: number;
  bytes: number;
  hits: number;
  misses: number;
  maxEntries: number;
  maxBytes: number;
  ttlMs: number;
}

export class HotHandleCache {
  private readonly entries = new Map<string, HotCacheEntry>();
  private readonly maxEntries: number;
  private readonly maxBytes: number;
  private readonly ttlMs: number;
  private hits = 0;
  private misses = 0;
  private currentBytes = 0;

  constructor(options: { maxEntries: number; maxBytes: number; ttlMs: number }) {
    this.maxEntries = Math.max(0, options.maxEntries);
    this.maxBytes = Math.max(0, options.maxBytes);
    this.ttlMs = Math.max(0, options.ttlMs);
  }

  get(id: string): string | undefined {
    this.pruneExpired();
    const entry = this.entries.get(id);
    if (!entry) {
      this.misses += 1;
      return undefined;
    }

    this.entries.delete(id);
    this.entries.set(id, entry);
    this.hits += 1;
    return entry.content;
  }

  put(id: string, content: string): void {
    if (this.maxEntries === 0 || this.maxBytes === 0 || this.ttlMs === 0) {
      return;
    }

    const bytes = Buffer.byteLength(content, 'utf8');
    if (bytes > this.maxBytes) {
      return;
    }

    const existing = this.entries.get(id);
    if (existing) {
      this.currentBytes -= existing.bytes;
      this.entries.delete(id);
    }

    const entry: HotCacheEntry = {
      id,
      content,
      bytes,
      expiresAt: Date.now() + this.ttlMs,
    };
    this.entries.set(id, entry);
    this.currentBytes += bytes;
    this.pruneToBudget();
  }

  clear(): void {
    this.entries.clear();
    this.currentBytes = 0;
  }

  stats(): HotCacheStats {
    this.pruneExpired();
    return {
      enabled: this.maxEntries > 0 && this.maxBytes > 0,
      entries: this.entries.size,
      bytes: this.currentBytes,
      hits: this.hits,
      misses: this.misses,
      maxEntries: this.maxEntries,
      maxBytes: this.maxBytes,
      ttlMs: this.ttlMs,
    };
  }

  private pruneExpired(): void {
    const now = Date.now();
    for (const [id, entry] of this.entries) {
      if (entry.expiresAt > now) continue;
      this.entries.delete(id);
      this.currentBytes -= entry.bytes;
    }
  }

  private pruneToBudget(): void {
    this.pruneExpired();
    while (this.entries.size > this.maxEntries || this.currentBytes > this.maxBytes) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (!oldest) break;
      const entry = this.entries.get(oldest);
      this.entries.delete(oldest);
      if (entry) this.currentBytes -= entry.bytes;
    }
  }
}
