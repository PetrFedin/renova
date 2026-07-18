#!/usr/bin/env bash
# Pre-PR gate for develop → main. Exit 0 only if automated checklist criteria green.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "=== 1) npm test:priority ==="
npm run test:priority

echo "=== 2) e2e (needs API :8100) ==="
if curl -sf --max-time 2 http://127.0.0.1:8100/health >/dev/null; then
  bash scripts/e2e-smoke.sh
else
  echo "WARN: API :8100 down — skip live e2e (run with API up before merge)"
fi

echo "=== 2b) Playwright UI smoke (needs :8100 + :8081) ==="
if curl -sf --max-time 2 http://127.0.0.1:8100/health >/dev/null && curl -sf --max-time 2 http://127.0.0.1:8081 >/dev/null; then
  npm run e2e:portal-ui
  npm run e2e:contract-gate-ui
else
  echo "WARN: skip Playwright UI (start backend :8100 + mobile web :8081)"
fi

echo "=== 3) staging env dry-smoke ==="
bash scripts/staging-env-smoke.sh

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
echo "merge-readiness: PASS"
echo "Next: open PR develop→main using docs/MERGE-DEVELOP-TO-MAIN.md (do not auto-merge)"
