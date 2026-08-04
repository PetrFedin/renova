#!/usr/bin/env bash
# Canonical staging/production configuration probe.
# By default validates the exact startup policy without live DB/Redis calls.
# Set LIVE=1 to include shared-auth connectivity and Alembic head verification.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT/backend/.env}"
LIVE="${LIVE:-0}"

if [ -n "$ENV_FILE" ] && [ "$ENV_FILE" != "/dev/null" ] && [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

if [ ! -x "$ROOT/backend/.venv/bin/python" ]; then
  echo "FAIL: backend/.venv is missing; run 'cd backend && poetry install' first" >&2
  exit 1
fi

args=(--json)
if [ "$LIVE" != "1" ]; then
  args+=(--skip-database --skip-runtime-services)
fi

set +e
payload=$(cd "$ROOT/backend" && .venv/bin/python -m app.core.runtime_preflight "${args[@]}" 2>&1)
status=$?
set -e

if ! printf '%s' "$payload" | python3 -m json.tool; then
  echo "FAIL: runtime preflight did not emit valid JSON" >&2
  printf '%s\n' "$payload" >&2
  exit 1
fi

if [ -n "${STAGING_PROBE_OUT:-}" ]; then
  printf '%s\n' "$payload" | python3 -m json.tool >"$STAGING_PROBE_OUT"
  echo "wrote $STAGING_PROBE_OUT"
fi

if [ "$status" -ne 0 ]; then
  echo "staging credentials probe: FAIL" >&2
  exit "$status"
fi

echo "staging credentials probe: PASS (live=$LIVE)"
