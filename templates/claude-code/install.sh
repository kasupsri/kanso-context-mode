#!/usr/bin/env bash
set -euo pipefail
claude mcp add kanso-context-mode -- npx -y kanso-context-mode
claude mcp list
