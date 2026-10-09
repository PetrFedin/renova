#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

API_URL="http://127.0.0.1:8100"
WEB_URL="http://127.0.0.1:8081"
EXPO_LOG="${RUNNER_TEMP:-/tmp}/renova-golden-expo.log"
EXPO_PID=""
API_CONTAINER_ID=""
API_STARTED_AT=""
API_RESTART_COUNT=""
COMPOSE=(docker compose --project-name renova-local --env-file "$ROOT/.env.local" -f "$ROOT/docker-compose.yml")

api_container_id() {
  "${COMPOSE[@]}" ps -q api
}

dump_runtime_diagnostics() {
  local current_id
  echo >&2
  echo "=== Golden runtime diagnostics ===" >&2
  "${COMPOSE[@]}" ps >&2 || true
  current_id="$(api_container_id 2>/dev/null || true)"
  if [ -n "$current_id" ]; then
    docker inspect --format 'api id={{.Id}} status={{.State.Status}} started={{.State.StartedAt}} restarts={{.RestartCount}} oom_killed={{.State.OOMKilled}} exit_code={{.State.ExitCode}} error={{.State.Error}}' "$current_id" >&2 || true
    docker stats --no-stream "$current_id" >&2 || true
  fi
  "${COMPOSE[@]}" logs --no-color --tail=240 api worker >&2 || true
  if [ -f "$EXPO_LOG" ]; then
    echo "=== Expo web tail ===" >&2
    tail -n 160 "$EXPO_LOG" >&2 || true
  fi
  echo "=== End Golden runtime diagnostics ===" >&2
}

capture_api_identity() {
  API_CONTAINER_ID="$(api_container_id)"
  if [ -z "$API_CONTAINER_ID" ]; then
    echo "Golden runtime API container is missing" >&2
    dump_runtime_diagnostics
    return 1
  fi
  API_STARTED_AT="$(docker inspect --format '{{.State.StartedAt}}' "$API_CONTAINER_ID")"
  API_RESTART_COUNT="$(docker inspect --format '{{.RestartCount}}' "$API_CONTAINER_ID")"
  printf 'Golden API identity: container=%s started=%s restarts=%s\n' \
    "$API_CONTAINER_ID" "$API_STARTED_AT" "$API_RESTART_COUNT"
}

assert_api_identity() {
  local label="$1"
  local current_id current_started current_restarts current_status
  current_id="$(api_container_id 2>/dev/null || true)"
  if [ -z "$current_id" ]; then
    echo "Golden API missing at ${label}" >&2
    dump_runtime_diagnostics
    return 1
  fi
  current_started="$(docker inspect --format '{{.State.StartedAt}}' "$current_id")"
  current_restarts="$(docker inspect --format '{{.RestartCount}}' "$current_id")"
  current_status="$(docker inspect --format '{{.State.Status}}' "$current_id")"
  if [ "$current_id" != "$API_CONTAINER_ID" ] \
    || [ "$current_started" != "$API_STARTED_AT" ] \
    || [ "$current_restarts" != "$API_RESTART_COUNT" ] \
    || [ "$current_status" != "running" ]; then
    echo "Golden API identity changed at ${label}: expected id=${API_CONTAINER_ID} started=${API_STARTED_AT} restarts=${API_RESTART_COUNT}; current id=${current_id} started=${current_started} restarts=${current_restarts} status=${current_status}" >&2
    dump_runtime_diagnostics
    return 1
  fi
  if ! curl -fsS "$API_URL/ready" >/dev/null; then
    echo "Golden API readiness failed at ${label}" >&2
    dump_runtime_diagnostics
    return 1
  fi
  printf 'Golden API identity stable at %s\n' "$label"
}

cleanup() {
  local status=$?
  if [ "$status" -ne 0 ]; then
    dump_runtime_diagnostics
  fi
  if [ -n "$EXPO_PID" ]; then
    kill "$EXPO_PID" 2>/dev/null || true
    wait "$EXPO_PID" 2>/dev/null || true
  fi
  bash scripts/dev-runtime.sh stop >/dev/null 2>&1 || true
  return "$status"
}
trap cleanup EXIT INT TERM

if [ ! -f .env.local ]; then
  cp env.local.example .env.local
fi

export RENOVA_DEV_NO_EXPO=1
bash scripts/dev-runtime.sh start
bash scripts/dev-runtime.sh seed

set -a
# shellcheck disable=SC1091
source .env.local
set +a
export BROWSER=none
export EXPO_WEB_URL="$WEB_URL"

(
  cd apps/mobile
  npm run web -- --port 8081 >"$EXPO_LOG" 2>&1
) &
EXPO_PID=$!

for _ in $(seq 1 90); do
  if curl -fsS "$API_URL/ready" >/dev/null 2>&1 && curl -fsS "$WEB_URL" >/dev/null 2>&1; then
    break
  fi
  if ! kill -0 "$EXPO_PID" 2>/dev/null; then
    echo "Expo web exited before Golden Paths started" >&2
    tail -n 120 "$EXPO_LOG" >&2 || true
    exit 2
  fi
  sleep 2
done

curl -fsS "$API_URL/ready" >/dev/null
curl -fsS "$WEB_URL" >/dev/null
capture_api_identity

api_status=0
mobile_status=0

npx playwright test -c e2e/playwright.config.ts e2e/golden --reporter=line || api_status=$?
if ! assert_api_identity "after API Golden Paths"; then
  api_status=1
fi

if assert_api_identity "before mobile-web Golden Paths"; then
  npx playwright test -c apps/mobile/e2e/golden/playwright.config.ts --reporter=line || mobile_status=$?
else
  mobile_status=1
fi
if ! assert_api_identity "after mobile-web Golden Paths"; then
  mobile_status=1
fi

printf "\nGolden Paths result: API=%s mobile-web=%s\n" "$api_status" "$mobile_status"
if [ "$api_status" -ne 0 ] || [ "$mobile_status" -ne 0 ]; then
  exit 1
fi
