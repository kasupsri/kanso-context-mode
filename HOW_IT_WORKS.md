# How Kanso Works

## Request flow

1. The MCP host calls a Kanso tool.
2. The tool produces a raw local result.
3. The response optimizer generates multiple compact candidates.
4. Kanso picks the smallest valid result that still fits the token budget.
5. The final response is returned to the host.
6. A durable compression event is written to SQLite.
7. Daily rollups are updated for project and global stats.

## Disk-first state

Kanso stores state in a per-user data directory using SQLite.

Main tables:

- `projects`
- `sessions`
- `content_handles`
- `compression_events`
- `daily_rollups`

Detailed events are retained for 30 days.
Daily rollups are kept indefinitely.

## Context handles

`read_file` and `read_references` can return a `context_id`.

That handle is:

- project-scoped
- persisted to SQLite
- valid until TTL expiry
- backed by a tiny hot cache for repeated reads

This keeps follow-up navigation fast without requiring large resident memory.

## Token estimation

Kanso supports local tokenizer-backed estimation for OpenAI-compatible profiles when available.
If a tokenizer profile is not available, it falls back to a deterministic heuristic.

Supported profiles:

- `auto`
- `openai_o200k`
- `openai_cl100k`
- `generic`

## Compression strategy selection

The optimizer keeps a small candidate set and scores them by:

- budget compliance
- token count
- output size
- error-marker preservation
- deterministic tie-breaking

Special handling exists for:

- JSON
- logs
- code
- markdown
- CSV
- diffs
- stack traces
- `.env` style content

## Host integrations

### Codex

- MCP-only integration
- no hooks in v1
- `AGENTS.md` routing block

### Cursor

- `.cursor/mcp.json`
- `.cursor/rules/kanso-context-mode.mdc`
- optional `.cursor/hooks.json`

### Claude Code

- `CLAUDE.md` routing block
- install script for `claude mcp add ...`
- optional `.claude/settings.local.json` hook config

## Why the cache is small

The hot cache is intentionally limited:

- 32 entries max
- 4 MB max memory
- 5 minute TTL

The source of truth always stays on disk.
