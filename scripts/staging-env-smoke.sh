#!/usr/bin/env bash
# Staging preflight plus optional remote API smoke.
# Local configuration uses the exact FastAPI startup policy. Remote protected
# checks require an explicit contractor Bearer token; demo/header fallbacks are forbidden.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
API_BASE="${API_BASE:-}"
TOKEN="${TOKEN:-}"
LIVE_DEPENDENCIES="${LIVE_DEPENDENCIES:-0}"
REQUIRE_INVESTOR_READY="${REQUIRE_INVESTOR_READY:-0}"
HEALTH_FILE="${HEALTH_FILE:-/tmp/renova-staging-health.json}"
H0_FILE="${H0_FILE:-/tmp/renova-staging-h0.json}"
RELEASE_FILE="${RELEASE_FILE:-/tmp/renova-staging-release-health.json}"


echo "=== 1) canonical configured-runtime preflight ==="
ENV_FILE="${ENV_FILE:-$ROOT/backend/.env}" \
LIVE="$LIVE_DEPENDENCIES" \
STAGING_PROBE_OUT="${STAGING_PROBE_OUT:-/tmp/renova-staging-preflight.json}" \
  bash "$ROOT/scripts/staging-credentials-probe.sh"


echo "=== 2) runtime policy unit contracts ==="
if [ ! -x "$ROOT/backend/.venv/bin/python" ]; then
  echo "FAIL: backend/.venv is missing; run 'cd backend && poetry install' first" >&2
  exit 1
fi
(
  cd "$ROOT/backend"
  .venv/bin/python -m pytest tests/test_environment_guards.py tests/test_runtime_preflight_integrity.py -q
)

if [ -z "$API_BASE" ]; then
  echo "SKIP remote API checks (set API_BASE=https://... and TOKEN=Bearer-JWT)"
  echo "staging-env-smoke: PASS (configured runtime only)"
  exit 0
fi

if [ -z "$TOKEN" ]; then
  echo "FAIL: TOKEN is required when API_BASE is set; demo and X-User-Id fallbacks are forbidden" >&2
  exit 1
fi

case "$API_BASE" in
  https://*) ;;
  *)
    echo "FAIL: remote API_BASE must use https://" >&2
    exit 1
    ;;
esac
API_BASE="${API_BASE%/}"


echo "=== 3) remote health ==="
curl --fail-with-body --silent --show-error --retry 3 --retry-delay 1 \
  "$API_BASE/health" >"$HEALTH_FILE"
python3 - "$HEALTH_FILE" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    payload = json.load(handle)
assert payload.get("status") == "ok", payload
assert payload.get("environment") in {"staging", "production"}, payload
print("remote health OK:", payload.get("environment"))
PY


echo "=== 4) protected H0 readiness via Bearer ==="
curl --fail-with-body --silent --show-error --retry 3 --retry-delay 1 \
  "$API_BASE/api/v1/admin/h0-readiness" \
  -H "Authorization: Bearer $TOKEN" >"$H0_FILE"
python3 - "$H0_FILE" "$REQUIRE_INVESTOR_READY" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    payload = json.load(handle)
assert payload.get("environment") in {"staging", "production"}, payload
checks = {item.get("id"): item for item in payload.get("checks", [])}
assert checks.get("auth_bearer", {}).get("ok") is True, payload
assert isinstance(payload.get("blockers"), list), payload
assert isinstance(payload.get("score"), int), payload
if sys.argv[2] == "1":
    assert payload.get("ready_for_investor_demo") is True, payload
print(
    "H0 readiness OK:",
    "score=", payload.get("score"),
    "ready=", payload.get("ready_for_investor_demo"),
    "blockers=", len(payload.get("blockers", [])),
)
PY


echo "=== 5) protected release-health via Bearer ==="
curl --fail-with-body --silent --show-error --retry 3 --retry-delay 1 \
  "$API_BASE/api/v1/admin/release-health" \
  -H "Authorization: Bearer $TOKEN" >"$RELEASE_FILE"
python3 - "$RELEASE_FILE" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    payload = json.load(handle)
assert payload.get("environment") in {"staging", "production"}, payload
assert isinstance(payload.get("integrations"), dict), payload
assert isinstance(payload["integrations"].get("outbox"), dict), payload
print("release-health contract OK")
PY


echo "staging-env-smoke: PASS (configured runtime + remote Bearer API)"
