# kanso-context-mode

`kanso-context-mode` is a disk-first MCP server for full-stack software developers who want LLMs to stay fast, accurate, and cheap on Windows and macOS.

It focuses on one job: keep noisy tool output out of the model context window without becoming a performance bottleneck.

## What It Ships In v1

- Deterministic compression with hard token budgets.
- Disk-backed `context_id` handles for selective file follow-up.
- A tiny bounded in-memory hot cache for repeated handle reads.
- MCP resources, prompts, and completions for reusable context flows.
- Sandboxed code execution with OS-aware shell selection.
- Focused tools for logs, diffs, code navigation, workspace search, terminal history, and token reporting.
- Optional provider-based web search with durable caching.
- Durable local stats with saved %, final output %, reduction ratio, and top-saving tool breakdowns.

## Why This Exists

Large raw outputs are one of the fastest ways to burn tokens and slow down an AI coding session.

Examples:

- `git diff` sends huge hunks the model does not need.
- build logs dump hundreds of repeated lines.
- full-file reads force the model to parse far more than the current task requires.

Kanso solves that with targeted retrieval and compact responses:

- `read_file` for ranges, query windows, and paging
- `read_symbols` / `read_references` for structure-first navigation
- `workspace_search` / `tree_focus` for repo exploration
- `git_focus` for changed files and minimal hunks
- `diagnostics_focus` for deduplicated build and test failures
- `terminal_history` / `run_focus` for command follow-up without replay
- `web_search` for optional grounded web context
- `edit_targets` for deterministic file/range ranking
- `stats_report` for session and all-time estimated token savings

## Supported Hosts

v1 directly supports:

- Codex
- Cursor
- Claude Code

Hooks are optional in Cursor and Claude Code. The server remains useful without them.

## Install

### From source

Requires Node.js 22 or 24 LTS.

```bash
git clone https://github.com/kasupsri/kanso-context-mode.git
cd kanso-context-mode
npm install
npm run build
npm run doctor
npm run stats
```

### With npx

Cursor:

```bash
npx -y kanso-context-mode setup cursor
```

Cursor with optional hooks:

```bash
npx -y kanso-context-mode setup cursor --hooks
```

Claude Code:

```bash
npx -y kanso-context-mode setup claude
claude mcp add kanso-context-mode -- npx -y kanso-context-mode
```

Codex:

```bash
npx -y kanso-context-mode setup codex
codex mcp add kanso-context-mode -- npx -y kanso-context-mode
```

## MCP Tools

- `compress`
- `edit_targets`
- `execute`
- `execute_file`
- `read_file`
- `read_symbols`
- `read_references`
- `workspace_search`
- `tree_focus`
- `git_focus`
- `diagnostics_focus`
- `structure_search`
- `rewrite_preview`
- `web_search`
- `terminal_history`
- `run_focus`
- `stats_report`
- `stats_export`
- `stats_reset`
- `doctor`

Additional MCP surfaces:

- resources: `context://`, `run://`, `session://`, `kb://`
- prompts: `summarize_run`, `review_diff`, `research_topic`, `draft_commit_message`
- completions for prompt args and resource template variables

All tools accept:

- `max_output_tokens`
- `response_mode` with `minimal` or `full`

### `read_file`

`read_file` accepts either a `path` or a `context_id`.

Supported selectors:

- `start_line`
- `end_line`
- `query`
- `context_lines`
- `max_matches`
- `cursor`
- `page_lines`
- `return_context_id`

The returned `context_id` is a snapshot handle stored on disk. It is not a live alias to the file.

### `workspace_search`

`workspace_search` prefers `rg --json` when available and falls back to a bounded Node walker.

Supported selectors:

- `root_path`
- `glob`
- `max_matches`
- `context_lines`
- `case_sensitive`
- `whole_word`
- `return_context_id`

### `web_search`

`web_search` uses an optional provider adapter and durable SQLite cache.

Supported providers:

- `brave_context`
- `firecrawl_search`
- `exa`

## Stats Model

`stats_report` is built around one question:

"How many tokens did Kanso keep out of the model context, what percent was that, and which tools did the work?"

Every tracked tool call is measured in three stages:

- `source`: the broad raw baseline Kanso avoided sending
- `candidate`: the tool's focused text before final response optimization
- `output`: the final text returned to the host

From those stages, Kanso derives:

- saved % of source
- final output % of source
- source-to-output reduction ratio
- retrieval vs compression split
- average saved tokens per event
- top-saving tool and its share of session savings

`stats_report` shows those metrics for:

- current session
- today for this project
- today globally
- all time for this project
- all time globally

Kanso labels token counts as estimated because hosts do not consistently expose exact tokenizer or prompt-cache usage for every MCP call.

If a tool is already very focused, its savings may legitimately be low or `0%`. That is not necessarily a bug; it often means the tool was already returning a narrow result.

`stats_export` writes the same snapshot to JSON, including a `schemaVersion` and the derived metrics above.

From a local checkout, you can print the same report in your terminal with:

```bash
npm run stats
```

## What Savings To Expect

The bundled full-tool benchmark currently covers all 24 exposed tools, including 20 tracked savings tools and 4 operational `n/a` tools.

Conservative local benchmark expectations today:

- aggregate tracked savings: `84.6%`
- compression and execution tools: `0.0% - 98.9%` per tool, `93.8%` aggregate
- retrieval and navigation tools: `0.0% - 94.7%` per tool, `63.6%` aggregate
- knowledge and web tools: `0.0% - 45.8%` per tool, `11.6%` aggregate

Those ranges are intentionally conservative:

- some tools already return narrow outputs, so their savings can be near zero
- some tools save mostly through retrieval, not through a tiny final rendered response
- all published numbers come from deterministic local fixtures or mocks, not marketing estimates

For the per-tool stress matrix and reproduction steps, see [BENCHMARK.md](./BENCHMARK.md).

## Memory Strategy

Kanso is disk-first.

Persistent state lives in SQLite under the per-user app data directory.

A small hot cache is allowed because it improves follow-up latency without becoming a bottleneck:

- max 96 entries
- max 8 MB total
- 10 minute TTL
- LRU eviction
- batched access tracking so hot reads do not write to SQLite on every lookup

## Environment Variables

| Variable                        | Default      | Notes                                                        |
| ------------------------------- | ------------ | ------------------------------------------------------------ |
| `KCM_STATE_DIR`                 | app data dir | Override local state directory                               |
| `KCM_DEFAULT_MAX_OUTPUT_TOKENS` | `400`        | Default output budget                                        |
| `KCM_HARD_MAX_OUTPUT_TOKENS`    | `800`        | Hard output cap                                              |
| `KCM_MAX_FILE_BYTES`            | `1048576`    | Max file size for file-oriented tools                        |
| `KCM_HANDLE_TTL_HOURS`          | `24`         | Disk handle TTL                                              |
| `KCM_HOT_CACHE_MB`              | `8`          | Hot cache memory budget                                      |
| `KCM_HOT_CACHE_ENTRIES`         | `96`         | Hot cache entry budget                                       |
| `KCM_HOT_CACHE_TTL_MS`          | `600000`     | Hot cache TTL in milliseconds                                |
| `KCM_CLEANUP_EVERY_WRITES`      | `64`         | How often Kanso runs background SQLite cleanup               |
| `KCM_MAX_FETCH_BYTES`           | `1048576`    | Max fetched response size for `fetch_and_index`              |
| `KCM_TOKEN_PROFILE`             | `auto`       | `auto`, `openai_o200k`, `openai_cl100k`, `generic`           |
| `KCM_POLICY_MODE`               | `strict`     | `strict`, `balanced`, `permissive`                           |
| `KCM_TIMEOUT_MS`                | `30000`      | Sandbox timeout                                              |
| `KCM_SHELL`                     | `auto`       | `auto`, `powershell`, `cmd`, `git-bash`, `bash`, `zsh`, `sh` |
| `KCM_WEB_SEARCH_PROVIDER`       | `off`        | `off`, `brave_context`, `firecrawl_search`, `exa`            |
| `KCM_WEB_SEARCH_TTL_HOURS`      | `24`         | Cache TTL for provider search results                        |
| `KCM_WEB_SEARCH_MAX_RESULTS`    | `5`          | Default result cap for `web_search`                          |
| `KCM_BRAVE_API_KEY`             | unset        | Brave Search / LLM Context API key                           |
| `KCM_FIRECRAWL_API_KEY`         | unset        | Firecrawl API key                                            |
| `KCM_EXA_API_KEY`               | unset        | Exa API key                                                  |
| `LOG_LEVEL`                     | `info`       | `debug`, `info`, `warn`, `error`                             |

## Development

```bash
npm install
npm run validate
npm run test:benchmarks
npm run doctor
```

Additional docs:

- [HOW_IT_WORKS.md](./HOW_IT_WORKS.md)
- [BENCHMARK.md](./BENCHMARK.md)
- [CONTRIBUTING.md](./CONTRIBUTING.md)

## License

MIT
