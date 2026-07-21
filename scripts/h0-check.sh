#!/usr/bin/env bash
# W54: единый H0 gate перед демо инвестору / TestFlight.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

STRICT=0
LIVE=0
for arg in "$@"; do
  case "$arg" in
    --strict) STRICT=1 ;;
    --live) LIVE=1 ;;
  esac
done

FAIL=0
WARN=0
pass() { echo "OK  $*"; }
warn() { echo "WARN $*"; WARN=$((WARN + 1)); }
fail() { echo "FAIL $*"; FAIL=$((FAIL + 1)); }

echo "=== Renova H0 check (investor / TestFlight gate) ==="

echo ""
echo "--- 1) EAS profiles (no localhost on release) ---"
if node apps/mobile/lib/__tests__/easProfiles.test.mjs; then
  pass "eas profiles"
else
  fail "eas profiles"
fi

echo ""
echo "--- 2) Placeholder staging URL ---"
if grep -q 'api-staging.example.com' apps/mobile/eas.json; then
  if [[ "$STRICT" -eq 1 ]]; then
    fail "eas.json still has api-staging.example.com — set real HTTPS API before TF"
  else
    warn "eas.json has api-staging.example.com (use --strict to fail)"
  fi
else
  pass "eas.json staging URL not placeholder"
fi

echo ""
echo "--- 3) Local env hints (optional .env) ---"
load_env() {
  local f="$1"
  if [[ -f "$f" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "$f"
    set +a
    echo "loaded $f"
  fi
}
load_env "backend/.env" || true
load_env ".env.staging" || true
load_env "env.staging" || true

ENV_NAME="${ENVIRONMENT:-development}"
PUB="${PUBLIC_BASE_URL:-}"
YK_SHOP="${YOOKASSA_SHOP_ID:-}"
YK_SEC="${YOOKASSA_SECRET:-}"

echo "ENVIRONMENT=${ENV_NAME}"
if [[ "$ENV_NAME" == "staging" || "$ENV_NAME" == "production" ]]; then
  pass "environment is $ENV_NAME"
else
  warn "ENVIRONMENT=$ENV_NAME (for pilot set staging)"
fi

if [[ -n "$PUB" ]]; then
  if [[ "$PUB" == https://* ]] && [[ "$PUB" != *localhost* ]] && [[ "$PUB" != *127.0.0.1* ]]; then
    pass "PUBLIC_BASE_URL https + not localhost"
  else
    fail "PUBLIC_BASE_URL must be https://... (not localhost): $PUB"
  fi
else
  warn "PUBLIC_BASE_URL empty (set in staging secrets)"
fi

if [[ -n "$YK_SHOP" && -n "$YK_SEC" ]]; then
  pass "YOOKASSA_* present in env"
else
  warn "YOOKASSA_SHOP_ID/SECRET missing locally (must be on staging server)"
fi

echo ""
echo "--- 4) Client API guard unit ---"
if (cd apps/mobile && npx tsx lib/apiBaseGuard.test.ts); then
  pass "apiBaseGuard"
else
  fail "apiBaseGuard"
fi

echo ""
echo "--- 5) Backend staging policy smoke (dry) ---"
if bash scripts/staging-env-smoke.sh; then
  pass "staging-env-smoke"
else
  fail "staging-env-smoke"
fi

echo ""
echo "--- 6) Live H0 readiness (optional) ---"
if [[ "$LIVE" -eq 1 || -n "${API_BASE:-}" ]]; then
  if [[ -z "${API_BASE:-}" ]]; then
    fail "--live requires API_BASE=https://..."
  else
    echo "API_BASE=$API_BASE"
    if curl -sf "$API_BASE/health" >/tmp/renova-h0-health.json; then
      python3 -c 'import json; d=json.load(open("/tmp/renova-h0-health.json")); print("health:", d.get("environment") or d.get("status") or d)'
    else
      fail "health unreachable"
    fi
    DEMO_ID=""
    DEMO_JSON="$(curl -sf -X POST "$API_BASE/api/v1/auth/demo" -H "Content-Type: application/json" -d "{\"role\":\"contractor\"}" || true)"
    if [[ -z "$DEMO_JSON" ]]; then
      warn "demo auth disabled on staging (expected) — use H0_USER_ID"
      DEMO_ID="${H0_USER_ID:-}"
    else
      DEMO_ID="$(python3 -c "import json,sys; print(json.load(sys.stdin)[\"id\"])" <<< "$DEMO_JSON")"
    fi
    if [[ -n "${DEMO_ID:-}" ]]; then
      if curl -sf "$API_BASE/api/v1/admin/h0-readiness" -H "X-User-Id: $DEMO_ID" -o /tmp/renova-h0-readiness.json; then
        set +e
        python3 -c '
import json, sys
d=json.load(open("/tmp/renova-h0-readiness.json"))
print("ready_for_investor_demo:", d.get("ready_for_investor_demo"))
print("score:", d.get("score"))
print("hint:", d.get("hint"))
blockers=d.get("blockers") or []
if blockers:
    print("blockers:")
    for b in blockers:
        print(" -", b.get("id"), b.get("label"), "->", b.get("how"))
    sys.exit(2)
'
        RC=$?
        set -e
        if [[ $RC -eq 0 ]]; then
          pass "h0-readiness READY"
        else
          fail "h0-readiness has blockers"
        fi
      else
        fail "h0-readiness request failed"
      fi
    else
      warn "set H0_USER_ID=... to query /admin/h0-readiness"
    fi
  fi
else
  warn "skip live API (set API_BASE=https://... or --live)"
fi

echo ""
echo "--- 7) Investor 15-min demo script ---"
echo "1) Home: H0 chip READY, YuKassa live"
echo "2) Estimate lock / customer approve -> contract"
echo "3) Repair -> acceptance (one orchestrator)"
echo "4) Budget -> pay (live or honest requisites)"
echo "5) Documents -> act / digest preview"
echo "6) Portal magic link + Team QR"
echo "7) Do NOT show localhost / demo Pro bypass / WA Business"
pass "demo script printed (docs/H0-STAGING-RUNBOOK-2026-07-19.md)"

echo ""
echo "=== SUMMARY: FAIL=$FAIL WARN=$WARN ==="
if [[ "$FAIL" -gt 0 ]]; then
  echo "H0 NOT READY — fix FAIL items before investor demo"
  echo ""
  echo "=== Нужно от вас (секреты / infra, не код) ==="
  echo "1) Реальный HTTPS API → заменить api-staging.example.com в apps/mobile/eas.json"
  echo "2) YOOKASSA_SHOP_ID + YOOKASSA_SECRET на staging (payments_mode=live)"
  echo "3) ENVIRONMENT=staging, DEMO pay off (demo_allowed=false)"
  echo "4) PUBLIC_BASE_URL=https://… (portal magic-link)"
  echo "5) Postgres+Alembic smoke: bash scripts/staging-postgres-smoke.sh"
  echo "6) 2–3 paid Pro аккаунта для демо assign/paywall"
  echo "7) npm run h0:check:live против staging URL"
  echo "См. docs/H0-STAGING-RUNBOOK-2026-07-19.md"
  exit 1
fi
echo "H0 local checks passed (resolve WARN before TestFlight / live pay)"
if [[ "$WARN" -gt 0 ]]; then
  echo ""
  echo "Пилот (пункты 1–8) всё ещё ждёт: HTTPS API в eas.json, YuKassa live, PUBLIC_BASE_URL, Postgres smoke, Pro accounts, h0:check:live"
  echo "Подробно: docs/H0-STAGING-RUNBOOK-2026-07-19.md · docs/PRIORITY-50-PLAN-2026-07-20.md § H0"
fi
exit 0
