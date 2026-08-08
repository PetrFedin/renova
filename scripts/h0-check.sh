#!/usr/bin/env bash
# W54: единый H0 gate перед инвесторским показом / TestFlight.
# --strict is a real release gate: it always performs live Bearer verification.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

STRICT=0
LIVE=0
for arg in "$@"; do
  case "$arg" in
    --strict) STRICT=1 ;;
    --live) LIVE=1 ;;
    *) echo "FAIL unsupported argument: $arg" >&2; exit 2 ;;
  esac
done
if [[ "$STRICT" -eq 1 ]]; then LIVE=1; fi

LIVE_TOKEN="${TOKEN:-${H0_TOKEN:-}}"
FAIL=0
WARN=0
pass() { echo "OK  $*"; }
warn() { echo "WARN $*"; WARN=$((WARN + 1)); }
fail() { echo "FAIL $*"; FAIL=$((FAIL + 1)); }

echo "=== Renova H0 check (investor / TestFlight gate) ==="
echo "mode: strict=$STRICT live=$LIVE"

echo ""
echo "--- 1) EAS profiles / placeholder release URLs ---"
if node apps/mobile/lib/__tests__/easProfiles.test.mjs; then
  pass "eas profile structure"
else
  fail "eas profile structure"
fi
if grep -Eq 'https://[^" ]*example\.com' apps/mobile/eas.json; then
  if [[ "$STRICT" -eq 1 ]]; then
    fail "eas.json still contains placeholder example.com API URLs"
  else
    warn "eas.json still contains placeholder example.com API URLs"
  fi
else
  pass "eas.json release API URLs are not placeholders"
fi

echo ""
echo "--- 2) Local configured-runtime hints ---"
load_env() {
  local file="$1"
  if [[ -f "$file" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "$file"
    set +a
    echo "loaded $file"
  fi
}
load_env "backend/.env" || true
load_env ".env.staging" || true
load_env "env.staging" || true

ENV_NAME="${ENVIRONMENT:-development}"
PUB="${PUBLIC_BASE_URL:-}"
YK_SHOP="${YOOKASSA_SHOP_ID:-}"
YK_SEC="${YOOKASSA_SECRET:-}"

echo "ENVIRONMENT=$ENV_NAME"
if [[ "$ENV_NAME" == "staging" || "$ENV_NAME" == "production" ]]; then
  pass "local environment policy is $ENV_NAME"
else
  warn "local ENVIRONMENT=$ENV_NAME; live release truth is verified remotely below"
fi

if [[ -n "$PUB" ]]; then
  if [[ "$PUB" == https://* ]] && [[ "$PUB" != *localhost* ]] && [[ "$PUB" != *127.0.0.1* ]] && [[ "$PUB" != *example.com* ]]; then
    pass "PUBLIC_BASE_URL is real HTTPS"
  else
    fail "PUBLIC_BASE_URL must be real https://... and not localhost/example.com: $PUB"
  fi
else
  warn "PUBLIC_BASE_URL is not present locally"
fi

if [[ -n "$YK_SHOP" && -n "$YK_SEC" ]]; then
  pass "YOOKASSA_* present locally"
else
  warn "YOOKASSA_* not present locally; remote readiness must prove payment mode"
fi

echo ""
echo "--- 3) WebSocket/runtime prerequisites ---"
PY_BACKEND="python3"
if [[ -x backend/.venv/bin/python ]]; then
  PY_BACKEND="backend/.venv/bin/python"
elif [[ -x backend/.venv/bin/python3 ]]; then
  PY_BACKEND="backend/.venv/bin/python3"
fi
if "$PY_BACKEND" -c "import websockets; import uvicorn" >/dev/null 2>&1; then
  pass "websockets + uvicorn importable ($PY_BACKEND)"
else
  fail "websockets/uvicorn missing in $PY_BACKEND"
fi

if (cd apps/mobile && npx tsx lib/apiBaseGuard.test.ts); then
  pass "mobile apiBaseGuard"
else
  fail "mobile apiBaseGuard"
fi

echo ""
echo "--- 4) Bearer-only E2E/auth contract ---"
if bash scripts/assert-e2e-bearer.sh; then
  pass "assert-e2e-bearer"
else
  fail "assert-e2e-bearer"
fi

# Local configured-runtime probe remains useful, but never substitutes for live.
if [[ "$LIVE" -eq 0 ]]; then
  if bash scripts/staging-credentials-probe.sh; then
    pass "staging-credentials-probe config-only"
  else
    warn "staging-credentials-probe reported local configuration gaps"
  fi
fi

echo ""
echo "--- 5) Staging/runtime smoke ---"
if [[ "$LIVE" -eq 1 || -n "${API_BASE:-}" ]]; then
  if [[ -z "${API_BASE:-}" ]]; then
    fail "live H0 requires API_BASE=https://..."
  elif [[ "$API_BASE" != https://* || "$API_BASE" == *example.com* || "$API_BASE" == *localhost* || "$API_BASE" == *127.0.0.1* ]]; then
    fail "live H0 requires a real HTTPS API_BASE: $API_BASE"
  elif [[ -z "$LIVE_TOKEN" ]]; then
    fail "live H0 requires TOKEN or H0_TOKEN Bearer JWT"
  else
    INVESTOR_READY=0
    if [[ "$STRICT" -eq 1 ]]; then INVESTOR_READY=1; fi
    if API_BASE="$API_BASE" TOKEN="$LIVE_TOKEN" REQUIRE_REMOTE=1 REQUIRE_INVESTOR_READY="$INVESTOR_READY" \
      bash scripts/staging-env-smoke.sh; then
      pass "remote staging health + H0 + release-health via Bearer"
    else
      fail "remote staging health/H0/release-health"
    fi
  fi
else
  if REQUIRE_REMOTE=0 bash scripts/staging-env-smoke.sh; then
    pass "configured-runtime smoke only (remote NOT VERIFIED)"
  else
    fail "configured-runtime smoke"
  fi
  warn "live API not verified; use --live or --strict with API_BASE + TOKEN"
fi

echo ""
echo "--- 6) Live H0 blocker details (Bearer only) ---"
if [[ "$LIVE" -eq 1 && -n "${API_BASE:-}" && -n "$LIVE_TOKEN" ]]; then
  if curl --fail-with-body --silent --show-error --retry 2 \
    "$API_BASE/api/v1/admin/h0-readiness" \
    -H "Authorization: Bearer $LIVE_TOKEN" \
    -o /tmp/renova-h0-readiness.json; then
    set +e
    python3 - <<'PY'
import json
import sys

with open('/tmp/renova-h0-readiness.json', encoding='utf-8') as handle:
    data = json.load(handle)
print('ready_for_investor_demo:', data.get('ready_for_investor_demo'))
print('score:', data.get('score'))
print('hint:', data.get('hint'))
blockers = data.get('blockers') or []
if blockers:
    print('blockers:')
    for blocker in blockers:
        print(' -', blocker.get('id'), blocker.get('label'), '->', blocker.get('how'))
    sys.exit(2)
PY
    RC=$?
    set -e
    if [[ "$RC" -eq 0 ]]; then
      pass "h0-readiness READY"
    else
      fail "h0-readiness has blockers"
    fi
  else
    fail "h0-readiness Bearer request failed"
  fi
elif [[ "$LIVE" -eq 1 ]]; then
  fail "live H0 readiness was not queried because API_BASE/Bearer auth is missing"
else
  warn "live H0 blocker details not queried in config-only mode"
fi

echo ""
echo "--- 7) Investor 15-min scenario ---"
echo "1) Home: H0 chip READY, payment mode truthful"
echo "2) Estimate lock / customer approve -> contract"
echo "3) Repair -> acceptance (one orchestrator)"
echo "4) Budget -> pay (live or honest requisites)"
echo "5) Documents -> act / digest preview"
echo "6) Portal magic link + Team QR"
echo "7) Do NOT show localhost / demo Pro bypass / demo auth"
pass "scenario printed (docs/H0-STAGING-RUNBOOK-2026-07-19.md)"

echo ""
echo "=== SUMMARY: FAIL=$FAIL WARN=$WARN ==="
if [[ "$FAIL" -gt 0 ]]; then
  echo "H0 NOT READY — fix FAIL items before investor demo/TestFlight"
  echo "Required external inputs may include: real HTTPS API URLs, EAS project binding/token, live payment credentials and staging infrastructure."
  exit 1
fi
if [[ "$STRICT" -eq 1 && "$LIVE" -ne 1 ]]; then
  echo "H0 NOT READY — strict mode must be live"
  exit 1
fi
if [[ "$STRICT" -eq 1 ]]; then
  echo "H0 strict gate PASS — live Bearer staging readiness was verified"
else
  echo "H0 checks PASS for the executed scope; WARN items are not release approval"
fi
exit 0
