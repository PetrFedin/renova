#!/usr/bin/env bash
# Staging environment dry-smoke: policy guards + optional live health.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/backend"

ENV_NAME="${ENVIRONMENT:-staging}"
DB_URL="${DATABASE_URL:-postgresql+asyncpg://renova:x@127.0.0.1:5432/renova}"
PUB_URL="${PUBLIC_BASE_URL:-https://api-staging.example.com}"
SECRET="${SECRET_KEY:-}"

if [ -z "$SECRET" ]; then
  SECRET="$(openssl rand -hex 24)"
  echo "staging-env-smoke: SECRET_KEY пуст — ephemeral dry-run key"
fi

export SMOKE_ENV="$ENV_NAME" SMOKE_DB="$DB_URL" SMOKE_PUB="$PUB_URL" SMOKE_SECRET="$SECRET"

echo "=== 1) validate_runtime_settings ($ENV_NAME) ==="
.venv/bin/python - <<'PY'
import os
from app.core.environment import validate_runtime_settings, collect_warnings
p = validate_runtime_settings(
    environment=os.environ["SMOKE_ENV"],
    database_url=os.environ["SMOKE_DB"],
    public_base_url=os.environ["SMOKE_PUB"],
    secret_key=os.environ["SMOKE_SECRET"],
)
print("OK policy:", p.name, "sqlite=", p.allow_sqlite, "seed=", p.allow_demo_seed)
for w in collect_warnings(
    environment=os.environ["SMOKE_ENV"],
    database_url=os.environ["SMOKE_DB"],
    secret_key=os.environ["SMOKE_SECRET"],
):
    print("WARN:", w)
PY

echo "=== 2) unit guards ==="
.venv/bin/python -m pytest tests/test_environment_guards.py -q

echo "=== 3) optional live health ==="
if [ -n "${API_BASE:-}" ]; then
  curl -sf "$API_BASE/health" | tee /tmp/renova-staging-health.json
  python3 -c "import json; d=json.load(open('/tmp/renova-staging-health.json')); assert d.get('environment') in ('staging','production'), d; print('health env OK:', d.get('environment'))"
else
  echo "SKIP live health (set API_BASE=https://… to enable)"
fi

echo "staging-env-smoke: PASS"
