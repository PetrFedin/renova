#!/usr/bin/env bash
# Pre-PR gate for develop/main integration. Exit 0 only if required automated criteria actually ran and passed.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "=== 1) npm test:priority ==="
npm run test:priority

echo "=== 2) API E2E — REQUIRED ==="
if ! curl -sf --max-time 2 http://127.0.0.1:8100/health >/dev/null; then
  echo "FAIL: API :8100 is unavailable; live E2E may not be skipped by merge-readiness" >&2
  echo "Start the backend, then rerun npm run merge:check." >&2
  exit 1
fi
bash scripts/e2e-smoke.sh
npm run e2e:api
npm run cleanup:e2e-gate || true

echo "=== 2b) Playwright UI smoke — REQUIRED ==="
if ! curl -sf --max-time 2 http://127.0.0.1:8081 >/dev/null; then
  echo "FAIL: mobile web :8081 is unavailable; UI E2E may not be skipped by merge-readiness" >&2
  echo "Start mobile web, then rerun npm run merge:check." >&2
  exit 1
fi
npm run e2e:portal-ui
npm run e2e:contract-gate-ui

echo "=== 3) configured staging-runtime dry smoke ==="
# This verifies configuration/runtime policy only. Remote staging is a separate
# release gate and must never be implied by this merge gate.
REQUIRE_REMOTE=0 bash scripts/staging-env-smoke.sh

echo "=== 4) SECRET_KEY guard proof ==="
cd "$ROOT/backend"
.venv/bin/python - <<'PY'
from app.core.environment import validate_runtime_settings

# production must reject default
try:
    validate_runtime_settings(
        environment="production",
        database_url="postgresql+asyncpg://u:p@db/r",
        public_base_url="https://api.example.com",
        secret_key="dev-secret-change-me",
    )
    raise SystemExit("FAIL: production accepted default SECRET_KEY")
except ValueError as e:
    assert "SECRET_KEY" in str(e), e
    print("OK: production rejects default SECRET_KEY")

# staging rejects short secret
try:
    validate_runtime_settings(
        environment="staging",
        database_url="postgresql+asyncpg://u:p@db/r",
        public_base_url="https://api-staging.example.com",
        secret_key="short",
    )
    raise SystemExit("FAIL: staging accepted short SECRET_KEY")
except ValueError as e:
    assert "SECRET_KEY" in str(e), e
    print("OK: staging rejects short SECRET_KEY")
PY

echo "=== 5) no weak secrets outside templates/config default ==="
# config.py may keep development default; examples may show it.
# Fail only if other runtime files hardcode weak keys.
HITS=$(rg -n "dev-secret-change-me|SECRET_KEY\s*=\s*[\"']?(change-me|changeme|secret)[\"']?\s*$" \
  backend apps scripts \
  --glob '!**/.env.example' \
  --glob '!**/.env.*.example' \
  --glob '!**/config.py' \
  --glob '!**/environment.py' \
  --glob '!**/test_*.py' \
  --glob '!**/__pycache__/**' \
  2>/dev/null || true)
if [ -n "${HITS}" ]; then
  echo "$HITS"
  echo "FAIL: unexpected weak SECRET_KEY literals"
  exit 1
fi
echo "OK: no unexpected weak SECRET literals"

echo ""
echo "merge-readiness: PASS (priority + API E2E + UI E2E + configured-runtime policy verified)"
echo "Remote staging/TestFlight readiness is intentionally separate and must use the live release gates."
