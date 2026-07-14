#!/usr/bin/env bash
# Local staging-like smoke on Postgres (Alembic + API health environment=staging).
# Не трогает main SQLite/dev API на :8100 — поднимает временный API на :8102.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

COMPOSE=(docker compose -f docker-compose.staging.yml)
PG_URL="postgresql+asyncpg://renova:renova@127.0.0.1:5435/renova_staging"
SECRET="${SECRET_KEY:-$(openssl rand -hex 24)}"
PUB_URL="${PUBLIC_BASE_URL:-https://api-staging.example.com}"
API_PORT="${STAGING_SMOKE_PORT:-8102}"
PID_FILE="/tmp/renova-staging-smoke-api.pid"
LOG_FILE="/tmp/renova-staging-smoke-api.log"

cleanup() {
  if [ -f "$PID_FILE" ]; then
    kill "$(cat "$PID_FILE")" 2>/dev/null || true
    rm -f "$PID_FILE"
  fi
}
trap cleanup EXIT

echo "=== 1) docker postgres (staging volume :5435) ==="
"${COMPOSE[@]}" up -d postgres
for i in $(seq 1 40); do
  if "${COMPOSE[@]}" exec -T postgres pg_isready -U renova -d renova_staging >/dev/null 2>&1; then
    echo "postgres ready"
    break
  fi
  sleep 1
  if [ "$i" -eq 40 ]; then
    echo "FAIL: postgres not ready"
    "${COMPOSE[@]}" logs --tail=40 postgres || true
    exit 1
  fi
done

echo "=== 2) alembic upgrade head ==="
cd "$ROOT/backend"
export ENVIRONMENT=staging
export DATABASE_URL="$PG_URL"
export PUBLIC_BASE_URL="$PUB_URL"
export SECRET_KEY="$SECRET"
export ALLOW_CREATE_ALL=false
export ALLOW_DEMO_SEED=false
# pydantic-settings читает .env — перекрываем через env
.venv/bin/alembic upgrade head
echo "alembic OK"

echo "=== 3) prove staging rejects sqlite ==="
set +e
ENVIRONMENT=staging DATABASE_URL="sqlite+aiosqlite:///./nope.db" \
  PUBLIC_BASE_URL="$PUB_URL" SECRET_KEY="$SECRET" \
  .venv/bin/python -c "from app.core.environment import validate_runtime_settings; validate_runtime_settings(environment='staging', database_url='sqlite+aiosqlite:///x', public_base_url='$PUB_URL', secret_key='$SECRET')" >/dev/null 2>&1
RC=$?
set -e
test "$RC" -ne 0
echo "OK: staging+sqlite rejected"

echo "=== 4) start temp API :$API_PORT ==="
cleanup
cd "$ROOT/backend"
ENVIRONMENT=staging \
DATABASE_URL="$PG_URL" \
PUBLIC_BASE_URL="$PUB_URL" \
SECRET_KEY="$SECRET" \
ALLOW_CREATE_ALL=false \
ALLOW_DEMO_SEED=false \
DOCUMENT_OCR_MODE=async \
nohup .venv/bin/uvicorn app.main:app --port "$API_PORT" --log-level warning >"$LOG_FILE" 2>&1 &
echo $! >"$PID_FILE"
sleep 1
for i in $(seq 1 30); do
  if curl -sf "http://127.0.0.1:$API_PORT/health" >/dev/null; then
    break
  fi
  sleep 0.5
  if [ "$i" -eq 30 ]; then
    echo "FAIL: API did not start"; tail -50 "$LOG_FILE"; exit 1
  fi
done

HEALTH=$(curl -sf "http://127.0.0.1:$API_PORT/health")
echo "$HEALTH" | tee /tmp/renova-staging-postgres-health.json
python3 - <<'PY'
import json
d=json.load(open("/tmp/renova-staging-postgres-health.json"))
assert d.get("status")=="ok", d
assert d.get("environment")=="staging", d
print("health environment=staging OK")
PY

echo "=== 5) OCR worker status on staging API ==="
# нужен user — staging без demo seed. Регистрируем через SMS/register как e2e.
USER_JSON=$(curl -sf -X POST "http://127.0.0.1:$API_PORT/api/v1/auth/register" \
  -H 'Content-Type: application/json' \
  -d "{\"phone\":\"+7999$(date +%s | tail -c 8)\",\"role\":\"customer\",\"full_name\":\"Staging Smoke\"}" \
  || curl -sf -X POST "http://127.0.0.1:$API_PORT/api/v1/auth/sms/verify" \
  -H 'Content-Type: application/json' \
  -d "{\"phone\":\"+7999$(date +%s | tail -c 8)\",\"code\":\"0000\",\"role\":\"customer\",\"full_name\":\"Staging Smoke\"}")
SMOKE_UID=$(echo "$USER_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")
curl -sf "http://127.0.0.1:$API_PORT/api/v1/ocr/worker" -H "X-User-Id: $SMOKE_UID" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); assert d['mode']=='async', d; print('OCR mode async OK', d)"

echo ""
echo "staging-postgres-smoke: PASS"
echo "  health: http://127.0.0.1:$API_PORT/health"
echo "  compose: docker compose -f docker-compose.staging.yml down   # optional cleanup"
