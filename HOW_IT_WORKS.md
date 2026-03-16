# How Kanso Works

## Request flow

1. The MCP host calls a Kanso tool.
2. The tool produces a raw local result.
3. High-volume tools can persist reusable state as `context://`, `run://`, `session://`, or `kb://` resources.
4. The response optimizer generates multiple compact candidates for the text portion of the result.
5. Kanso picks the smallest valid result that still fits the token budget.
6. The final text plus any `resource_link` blocks are returned to the host.
7. A durable compression event is written to SQLite.
8. Daily rollups are updated for project and global stats.

## Stats accounting

Every tracked Kanso tool call is measured in three stages:

- `source`: the broader raw baseline Kanso avoided sending
- `candidate`: the tool's focused text before final response optimization
- `output`: the final host-visible text after optimization

Kanso then derives:

- `retrieval_saved = max(0, source - candidate)`
- `compression_saved = max(0, candidate - output)`
- `total_saved = retrieval_saved + compression_saved`
- `savedPctOfSource = total_saved / source`
- `outputPctOfSource = output / source`
- `sourceToOutputRatio = source / output`

Percentages are token-based, not byte-based, because the user-facing question is about context window pressure.

Some tools can legitimately report low or zero savings:

- the tool may already return a narrow response
- the final rendered output may still be useful enough to keep largely intact
- the savings may come mostly from retrieval instead of final-response compression

When the stats accounting model changes, Kanso clears old `compression_events` and `daily_rollups` once and starts a clean stats window under the new schema version so reports stay comparable.

## Disk-first state

Kanso stores state in a per-user data directory using SQLite.

Main tables:

- `app_metadata`
- `projects`
- `sessions`
- `content_handles`
- `compression_events`
- `daily_rollups`
- `terminal_runs`
- `web_search_cache`

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

## MCP surfaces

Kanso now exposes more than tools:

- resources for `context://`, `run://`, `session://`, and `kb://`
- prompts for common workflows such as run summarization and diff review
- completions for prompt arguments and resource template variables

This lets hosts fetch the next piece of context instead of replaying the original raw output.

## Terminal and web memory

`execute` and `execute_file` can persist terminal runs with a saved output handle.

That data powers:

- `terminal_history`
- `run_focus`
- richer `session_resume` snapshots

`web_search` results can be cached locally by provider + normalized query so repeated research loops avoid repeated remote fetches.

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

- 96 entries max
- 8 MB max memory
- 10 minute TTL

Handle access metadata is flushed in small batches, so repeated `context://` reads stay fast without losing the recent-access ordering that resource completions rely on.

The source of truth always stays on disk.
