#!/usr/bin/env bash
# CI Playwright: API E2E (:8100) and optional UI E2E (+ :8081 Expo web).
# Usage: bash scripts/ci-playwright.sh [api|ui|all]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MODE="${1:-all}"
API_PORT="${API_PORT:-8100}"
WEB_PORT="${WEB_PORT:-8081}"
API_URL="http://127.0.0.1:${API_PORT}"
WEB_URL="http://127.0.0.1:${WEB_PORT}"

BACK_PID=""
EXPO_PID=""

cleanup() {
  [ -n "$EXPO_PID" ] && kill "$EXPO_PID" 2>/dev/null || true
  [ -n "$BACK_PID" ] && kill "$BACK_PID" 2>/dev/null || true
}
trap cleanup EXIT

wait_http() {
  local url="$1" label="$2" max="${3:-30}" sleep_s="${4:-1}"
  for i in $(seq 1 "$max"); do
    if curl -sf "$url" >/dev/null; then
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
  export ENVIRONMENT=development
  export DATABASE_URL="sqlite+aiosqlite:///${db_file}"
  export PUBLIC_BASE_URL="$API_URL"
  export SECRET_KEY="${SECRET_KEY:-ci-secret-key-at-least-16}"
  poetry run uvicorn app.main:app --host 127.0.0.1 --port "$API_PORT" &
  BACK_PID=$!
  cd "$ROOT"
  wait_http "${API_URL}/health" "API"
}

start_expo_web() {
  cd "$ROOT/apps/mobile"
  export BROWSER=none
  npx expo start --web --port "$WEB_PORT" &
  EXPO_PID=$!
  cd "$ROOT"
  wait_http "${WEB_URL}/" "Expo web" 45 2
}

run_api_e2e() {
  start_api "./ci-playwright-api.db"
  npm run e2e:api
  npm run cleanup:e2e-gate || true
}

run_ui_e2e() {
  start_api "./ci-playwright-ui.db"
  start_expo_web
  npm run e2e:portal-ui
  npm run e2e:contract-gate-ui
  npm run cleanup:e2e-gate || true
}

case "$MODE" in
  api) run_api_e2e ;;
  ui) run_ui_e2e ;;
  all) run_api_e2e; cleanup; BACK_PID=""; EXPO_PID=""; run_ui_e2e ;;
  *) echo "Usage: $0 [api|ui|all]"; exit 1 ;;
esac

echo "ci-playwright (${MODE}): PASS"
