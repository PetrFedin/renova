#!/usr/bin/env bash
# Backward-compatible root dispatcher. The canonical runtime lives in dev-runtime.sh.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [ "$#" -eq 0 ]; then
  set -- start
fi
exec bash "${ROOT}/scripts/dev-runtime.sh" "$@"
