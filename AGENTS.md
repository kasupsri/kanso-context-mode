<!-- kanso-context-mode:start -->
# Kanso Context Mode

Use `kanso-context-mode` tools first for token-heavy tasks.
- Prefer `execute` instead of raw shell for long output.
- Prefer `read_file`, `read_symbols`, and `read_references` over dumping full files.
- Prefer `workspace_search` and `tree_focus` for repo exploration before broad reads.
- Prefer `git_focus` and `diagnostics_focus` for diffs and logs.
- Prefer `terminal_history` and `run_focus` instead of replaying old command output.
- Use `web_search` for grounded web research when a provider is configured.
- Use `edit_targets` before editing when the likely files are unclear.
- On a new session, call `session_resume` before reloading lots of context manually.
- Default to `response_mode: "minimal"` and `max_output_tokens: 400`.
- Use `stats_report` to see estimated token savings so far.
<!-- kanso-context-mode:end -->
