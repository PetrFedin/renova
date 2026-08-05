#!/usr/bin/env bash
# CI Playwright: API E2E (:8100) and UI E2E (+ :8081 Expo web).
# Usage: bash scripts/ci-playwright.sh [api|ui|all]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MODE="${1:-all}"
API_PORT="${API_PORT:-8100}"
WEB_PORT="${WEB_PORT:-8081}"
API_URL="http://127.0.0.1:${API_PORT}"
WEB_URL="http://127.0.0.1:${WEB_PORT}"
REPORT_DIR="$ROOT/.artifacts/playwright"

BACK_PID=""
EXPO_PID=""
mkdir -p "$REPORT_DIR"

stop_pid() {
  local pid="${1:-}"
  local label="${2:-process}"
  if [ -z "$pid" ]; then
    return 0
  fi
  if kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null || true
    for _ in $(seq 1 40); do
      if ! kill -0 "$pid" 2>/dev/null; then
        break
      fi
      sleep 0.25
    done
    if kill -0 "$pid" 2>/dev/null; then
      echo "WARN: ${label} did not stop gracefully; forcing termination"
      kill -9 "$pid" 2>/dev/null || true
    fi
  fi
  wait "$pid" 2>/dev/null || true
  echo "${label} stopped"
}

cleanup() {
  local expo_pid="$EXPO_PID"
  local back_pid="$BACK_PID"
  EXPO_PID=""
  BACK_PID=""
  stop_pid "$expo_pid" "Expo web"
  stop_pid "$back_pid" "API"
}
trap cleanup EXIT

wait_http() {
  local url="$1"
  local label="$2"
  local pid="$3"
  local max="${4:-30}"
  local sleep_s="${5:-1}"
  for _ in $(seq 1 "$max"); do
    if ! kill -0 "$pid" 2>/dev/null; then
      wait "$pid" 2>/dev/null || true
      echo "FAIL: ${label} process exited before readiness at ${url}"
      return 1
    fi
    if curl -sf "$url" >/dev/null; then
      if ! kill -0 "$pid" 2>/dev/null; then
        wait "$pid" 2>/dev/null || true
        echo "FAIL: ${label} process exited during readiness at ${url}"
        return 1
      fi
      echo "${label} ready"
      return 0
    fi
    sleep "$sleep_s"
  done
  echo "FAIL: ${label} not ready at ${url}"
  return 1
}

start_api() {
  local db_file="${1:-./ci-playwright.db}"
  cd "$ROOT/backend"
  rm -f "$db_file" "${db_file}-wal" "${db_file}-shm"
  export ENVIRONMENT=development
  export DATABASE_URL="sqlite+aiosqlite:///${db_file}"
  export PUBLIC_BASE_URL="$API_URL"
  export SECRET_KEY="${SECRET_KEY:-ci-secret-key-at-least-16}"
  if command -v poetry >/dev/null 2>&1; then
    poetry run uvicorn app.main:app --host 127.0.0.1 --port "$API_PORT" &
  elif [ -x "$ROOT/backend/.venv/bin/uvicorn" ]; then
    "$ROOT/backend/.venv/bin/uvicorn" app.main:app --host 127.0.0.1 --port "$API_PORT" &
  else
    echo "FAIL: need poetry or backend/.venv/bin/uvicorn"
    exit 1
  fi
  BACK_PID=$!
  cd "$ROOT"
  wait_http "${API_URL}/health" "API" "$BACK_PID"
}

start_expo_web() {
  cd "$ROOT/apps/mobile"
  export BROWSER=none
  npx expo start --web --port "$WEB_PORT" &
  EXPO_PID=$!
  cd "$ROOT"
  wait_http "${WEB_URL}/" "Expo web" "$EXPO_PID" 45 2
}

run_playwright_suite() {
  local suite="$1"
  local min_expected="$2"
  shift 2
  local report="$REPORT_DIR/${suite}.json"
  rm -f "$report"
  RENOVA_API="$API_URL" \
  RENOVA_WEB="$WEB_URL" \
  RENOVA_E2E_REQUIRE_SERVICES=1 \
  RENOVA_PLAYWRIGHT_JSON_REPORT="$report" \
    npx playwright test -c e2e/playwright.config.ts "$@"
  node scripts/assert-playwright-report.mjs \
    "$report" \
    "--min-expected=${min_expected}" \
    --max-skipped=0
}

run_api_e2e() {
  start_api "./ci-playwright-api.db"
  run_playwright_suite api 3 \
    e2e/project-lifecycle.spec.ts \
    e2e/portal-documents.spec.ts \
    e2e/contract-gate-path.spec.ts
  npm run cleanup:e2e-gate || true
}

run_ui_e2e() {
  start_api "./ci-playwright-ui.db"
  start_expo_web
  run_playwright_suite ui 5 \
    e2e/service-readiness.spec.ts \
    e2e/portal-documents-ui.spec.ts \
    e2e/contract-gate-ui.spec.ts \
    e2e/mobile-surface-integrity.spec.ts \
    e2e/outbox-dead-letter-admin-ui.spec.ts
  npm run cleanup:e2e-gate || true
}

case "$MODE" in
  api) run_api_e2e ;;
  ui) run_ui_e2e ;;
  all) run_api_e2e; cleanup; run_ui_e2e ;;
  *) echo "Usage: $0 [api|ui|all]"; exit 1 ;;
esac

echo "ci-playwright (${MODE}): PASS"
