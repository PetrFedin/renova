#!/usr/bin/env bash
# Start Renova API on :8100 for local merge/e2e. Prints PID to stdout; caller owns cleanup.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
API_PORT="${API_PORT:-8100}"
API_URL="http://127.0.0.1:${API_PORT}"
DB_FILE="${1:-./merge-check.db}"

if curl -sf --max-time 2 "${API_URL}/health" >/dev/null; then
  echo "API already up at ${API_URL}"
  echo ""
  exit 0
fi

cd "$ROOT/backend"
export ENVIRONMENT=development
export DATABASE_URL="sqlite+aiosqlite:///${DB_FILE}"
export PUBLIC_BASE_URL="$API_URL"
export SECRET_KEY="${SECRET_KEY:-ci-secret-key-at-least-16}"

if command -v poetry >/dev/null 2>&1; then
  poetry run uvicorn app.main:app --host 127.0.0.1 --port "$API_PORT" &
elif [ -x "$ROOT/backend/.venv/bin/uvicorn" ]; then
  "$ROOT/backend/.venv/bin/uvicorn" app.main:app --host 127.0.0.1 --port "$API_PORT" &
else
  echo "FAIL: need poetry or backend/.venv for API"
  exit 1
fi
BACK_PID=$!
cd "$ROOT"

for i in $(seq 1 30); do
  if curl -sf "${API_URL}/health" >/dev/null; then
    echo "API ready (${API_URL}) pid=${BACK_PID}"
    echo "$BACK_PID"
    exit 0
  fi
  sleep 1
done
kill "$BACK_PID" 2>/dev/null || true
echo "FAIL: API did not start"
exit 1
