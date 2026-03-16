# Contributing to kanso-context-mode

Thanks for helping build a token-efficient MCP tool for real software development workflows.

## Local setup

```bash
git clone https://github.com/kasupsri/kanso-context-mode.git
cd kanso-context-mode
npm install
npm run build
npm test
```

## Quality bar

Before opening a PR, run:

```bash
npm run build
npm test
npm run test:benchmarks
npm run lint
npm run format:check
```

## Project shape

```text
src/
  adapters/       Host-specific setup flows
  compression/    Deterministic response shrinking
  config/         Defaults and env parsing
  hooks/          Optional routing nudges for hosts that support hooks
  sandbox/        Runtime resolution and execution helpers
  security/       Command and path policy checks
  state/          SQLite state and hot-cache management
  tools/          MCP tool implementations
  utils/          Logging and token estimation

tests/kanso/
  unit/           Core behavior tests
  integration/    MCP protocol and end-to-end tool tests

tests/kanso-benchmarks/
  smoke/ratio checks for compression behavior
```

## Contribution rules

- Keep responses deterministic.
- Keep the disk store as the source of truth.
- Do not introduce large unbounded memory caches.
- Preserve Windows and macOS behavior when changing shell or path logic.
- Add or update tests for every behavior change.
- Keep docs aligned with the public CLI and MCP tool names.
