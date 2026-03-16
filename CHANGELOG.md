# Changelog

## 1.0.0

- Stabilized CI with a single validation entrypoint, shared coverage timeout config, and non-fail-fast matrix execution.
- Promoted the package to `1.0.0` and centralized runtime version reporting.
- Added `KCM_MAX_FETCH_BYTES`, fixed default fetch sizing, and declared `turndown` for reliable HTML-to-Markdown conversion.
- Hardened user-supplied path handling for indexing and stats export.
- Fixed Rust execution to compile and run instead of compile-only behavior.
- Narrowed the supported v1 setup surface to Codex, Cursor, and Claude Code.
