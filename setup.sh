#!/usr/bin/env bash
set -euo pipefail

SKIP_INSTALL=false
SKIP_BUILD=false
SKIP_TESTS=false
SKIP_DOCTOR=false
WITH_HOOKS=false
HOSTS=()

for arg in "$@"; do
  case "$arg" in
    --skip-install) SKIP_INSTALL=true ;;
    --skip-build) SKIP_BUILD=true ;;
    --skip-tests) SKIP_TESTS=true ;;
    --skip-doctor) SKIP_DOCTOR=true ;;
    --hooks) WITH_HOOKS=true ;;
    codex|cursor|claude|auto) HOSTS+=("$arg") ;;
    *)
      echo "Unknown option: $arg"
      echo "Valid options: --skip-install --skip-build --skip-tests --skip-doctor --hooks [auto|codex|cursor|claude]"
      exit 1
      ;;
  esac
done

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_ROOT"

if [[ "$SKIP_INSTALL" == "false" ]]; then npm install; fi
if [[ "$SKIP_BUILD" == "false" ]]; then npm run build; fi
if [[ "$SKIP_TESTS" == "false" ]]; then npm test; fi
if [[ "$SKIP_DOCTOR" == "false" ]]; then npm run doctor; fi

if [[ ${#HOSTS[@]} -eq 0 ]]; then
  HOSTS=(auto)
fi

for host in "${HOSTS[@]}"; do
  if [[ "$WITH_HOOKS" == "true" ]]; then
    node ./dist/index.js setup "$host" --hooks
  else
    node ./dist/index.js setup "$host"
  fi
done
