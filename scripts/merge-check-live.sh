#!/usr/bin/env bash
# merge:check with auto-start API when :8100 is down (best-effort stop on exit).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
BACK_PID=""

cleanup() {
  if [ -n "$BACK_PID" ]; then
    kill "$BACK_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

if ! curl -sf --max-time 2 http://127.0.0.1:8100/health >/dev/null; then
  echo "=== merge-check-live: starting API ==="
  BACK_PID="$(bash scripts/start-api-dev.sh | tail -1)"
fi

bash scripts/merge-readiness.sh
