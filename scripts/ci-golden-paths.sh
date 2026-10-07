#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

API_URL="http://127.0.0.1:8100"
WEB_URL="http://127.0.0.1:8081"
EXPO_LOG="${RUNNER_TEMP:-/tmp}/renova-golden-expo.log"
EXPO_PID=""

cleanup() {
  if [ -n "$EXPO_PID" ]; then
    kill "$EXPO_PID" 2>/dev/null || true
    wait "$EXPO_PID" 2>/dev/null || true
  fi
  bash scripts/dev-runtime.sh stop >/dev/null 2>&1 || true
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

api_status=0
mobile_status=0

npx playwright test -c e2e/playwright.config.ts e2e/golden --reporter=line || api_status=$?
npx playwright test -c apps/mobile/e2e/golden/playwright.config.ts --reporter=line || mobile_status=$?

printf "\nGolden Paths result: API=%s mobile-web=%s\n" "$api_status" "$mobile_status"
if [ "$api_status" -ne 0 ] || [ "$mobile_status" -ne 0 ]; then
  exit 1
fi
