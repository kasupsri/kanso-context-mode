# kanso-context-mode

`kanso-context-mode` is a disk-first MCP server for full-stack software developers who want LLMs to stay fast, accurate, and cheap on Windows and macOS.

It focuses on one job: keep noisy tool output out of the model context window without becoming a performance bottleneck.

## What It Ships In v1

- Deterministic compression with hard token budgets.
- Disk-backed `context_id` handles for selective file follow-up.
- A tiny bounded in-memory hot cache for repeated handle reads.
- Sandboxed code execution with OS-aware shell selection.
- Focused tools for logs, diffs, code navigation, and token reporting.
- Durable local stats so you can see how many estimated tokens were saved so far.

## Why This Exists

Large raw outputs are one of the fastest ways to burn tokens and slow down an AI coding session.

Examples:

- `git diff` sends huge hunks the model does not need.
- build logs dump hundreds of repeated lines.
- full-file reads force the model to parse far more than the current task requires.

Kanso solves that with targeted retrieval and compact responses:

- `read_file` for ranges, query windows, and paging
- `read_symbols` / `read_references` for structure-first navigation
- `git_focus` for changed files and minimal hunks
- `diagnostics_focus` for deduplicated build and test failures
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
- `execute`
- `execute_file`
- `read_file`
- `read_symbols`
- `read_references`
- `git_focus`
- `diagnostics_focus`
- `stats_report`
- `stats_export`
- `stats_reset`
- `doctor`

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

## Stats Model

`stats_report` shows estimated savings for:

- current session
- today for this project
- today globally
- all time for this project
- all time globally

Kanso labels token counts as estimated because hosts do not consistently expose exact tokenizer or prompt-cache usage for every MCP call.

## Memory Strategy

Kanso is disk-first.

Persistent state lives in SQLite under the per-user app data directory.

A small hot cache is allowed because it improves follow-up latency without becoming a bottleneck:

- max 32 entries
- max 4 MB total
- 5 minute TTL
- LRU eviction

## Environment Variables

| Variable                        | Default      | Notes                                                        |
| ------------------------------- | ------------ | ------------------------------------------------------------ |
| `KCM_STATE_DIR`                 | app data dir | Override local state directory                               |
| `KCM_DEFAULT_MAX_OUTPUT_TOKENS` | `400`        | Default output budget                                        |
| `KCM_HARD_MAX_OUTPUT_TOKENS`    | `800`        | Hard output cap                                              |
| `KCM_MAX_FILE_BYTES`            | `1048576`    | Max file size for file-oriented tools                        |
| `KCM_HANDLE_TTL_HOURS`          | `24`         | Disk handle TTL                                              |
| `KCM_HOT_CACHE_MB`              | `4`          | Hot cache memory budget                                      |
| `KCM_MAX_FETCH_BYTES`           | `1048576`    | Max fetched response size for `fetch_and_index`              |
| `KCM_TOKEN_PROFILE`             | `auto`       | `auto`, `openai_o200k`, `openai_cl100k`, `generic`           |
| `KCM_POLICY_MODE`               | `strict`     | `strict`, `balanced`, `permissive`                           |
| `KCM_TIMEOUT_MS`                | `30000`      | Sandbox timeout                                              |
| `KCM_SHELL`                     | `auto`       | `auto`, `powershell`, `cmd`, `git-bash`, `bash`, `zsh`, `sh` |
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
