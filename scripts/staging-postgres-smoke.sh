#!/usr/bin/env bash
# End-to-end staging runtime smoke on isolated PostgreSQL + Redis.
# Does not touch the local SQLite/dev API on :8100; starts a temporary API on :8102.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

COMPOSE=(docker compose -f docker-compose.staging.yml)
PG_URL="postgresql+asyncpg://renova:renova@127.0.0.1:5435/renova_staging"
REDIS_URL_VALUE="redis://127.0.0.1:6381/0"
SECRET="${SECRET_KEY:-$(openssl rand -hex 24)}"
PUB_URL="${PUBLIC_BASE_URL:-https://api-staging.example.com}"
API_PORT="${STAGING_SMOKE_PORT:-8102}"
ADMIN_ID="${STAGING_SMOKE_ADMIN_ID:-staging-smoke-admin}"
TWILIO_SID_VALUE="${TWILIO_SID:-AC00000000000000000000000000000000}"
TWILIO_TOKEN_VALUE="${TWILIO_TOKEN:-staging-smoke-token-not-for-delivery}"
TWILIO_FROM_VALUE="${TWILIO_FROM:-+15005550006}"
PID_FILE="/tmp/renova-staging-smoke-api.pid"
LOG_FILE="/tmp/renova-staging-smoke-api.log"
HEALTH_FILE="/tmp/renova-staging-postgres-health.json"
HEADER_AUTH_FILE="/tmp/renova-staging-header-auth.json"
OCR_FORBIDDEN_FILE="/tmp/renova-staging-ocr-forbidden.json"
OCR_FILE="/tmp/renova-staging-ocr-worker.json"
H0_FILE="/tmp/renova-staging-h0-readiness.json"
PREFLIGHT_FILE="/tmp/renova-staging-preflight.json"

cleanup() {
  if [ -f "$PID_FILE" ]; then
    local pid
    pid="$(cat "$PID_FILE")"
    kill "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
    rm -f "$PID_FILE"
  fi
}
trap cleanup EXIT

if [ ! -x "$ROOT/backend/.venv/bin/python" ]; then
  echo "FAIL: backend/.venv is missing; run 'cd backend && poetry install' first" >&2
  exit 1
fi

export ENVIRONMENT=staging
export DATABASE_URL="$PG_URL"
export REDIS_URL="$REDIS_URL_VALUE"
export PUBLIC_BASE_URL="$PUB_URL"
export SECRET_KEY="$SECRET"
export ADMIN_USER_IDS="$ADMIN_ID"
export TWILIO_SID="$TWILIO_SID_VALUE"
export TWILIO_TOKEN="$TWILIO_TOKEN_VALUE"
export TWILIO_FROM="$TWILIO_FROM_VALUE"
export ALLOW_CREATE_ALL=false
export ALLOW_DEMO_SEED=false
export AUTH_ALLOW_HEADER_USER_ID=false
export DOCUMENT_OCR_MODE=metadata
export AUTOMATION_REMINDERS_ENABLED=false


echo "=== 1) start isolated PostgreSQL :5435 and Redis :6381 ==="
"${COMPOSE[@]}" up -d postgres redis
for i in $(seq 1 40); do
  if "${COMPOSE[@]}" exec -T postgres pg_isready -U renova -d renova_staging >/dev/null 2>&1; then
    echo "postgres ready"
    break
  fi
  sleep 1
  if [ "$i" -eq 40 ]; then
    echo "FAIL: postgres not ready" >&2
    "${COMPOSE[@]}" logs --tail=40 postgres || true
    exit 1
  fi
done
for i in $(seq 1 40); do
  if "${COMPOSE[@]}" exec -T redis redis-cli ping 2>/dev/null | grep -qx PONG; then
    echo "redis ready"
    break
  fi
  sleep 1
  if [ "$i" -eq 40 ]; then
    echo "FAIL: redis not ready" >&2
    "${COMPOSE[@]}" logs --tail=40 redis || true
    exit 1
  fi
done


echo "=== 2) migrate, create explicit admin fixture, and run live preflight ==="
cd "$ROOT/backend"
.venv/bin/alembic upgrade head
.venv/bin/python - <<'PY'
import asyncio
import os

from app.db.session import SessionLocal
from app.models.entities import User, UserRole


async def main() -> None:
    admin_id = os.environ["ADMIN_USER_IDS"]
    if not admin_id or "," in admin_id:
        raise SystemExit("staging smoke requires exactly one ADMIN_USER_IDS fixture")
    async with SessionLocal() as db:
        existing = await db.get(User, admin_id)
        if existing is None:
            db.add(
                User(
                    id=admin_id,
                    phone="+79990009501",
                    role=UserRole.contractor,
                    full_name="Staging Runtime Admin",
                )
            )
            await db.commit()
        elif existing.role != UserRole.contractor:
            raise SystemExit("existing staging smoke admin is not a contractor")


asyncio.run(main())
PY
.venv/bin/python -m app.core.runtime_preflight --json | tee "$PREFLIGHT_FILE"
python3 - "$PREFLIGHT_FILE" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    payload = json.load(handle)
assert payload.get("ok") is True, payload
checks = {item.get("name"): item for item in payload.get("checks", [])}
assert checks.get("storage_configuration", {}).get("ok") is True, payload
assert checks.get("storage_runtime", {}).get("ok") is True, payload
assert checks.get("shared_auth_runtime", {}).get("ok") is True, payload
assert checks.get("database_revision", {}).get("ok") is True, payload
assert checks.get("admin_identity_database", {}).get("ok") is True, payload
assert "configured_count=1" in checks["admin_identity_database"].get("detail", ""), payload
print("canonical live preflight and admin identity OK")
PY


echo "=== 3) prove staging policy rejects SQLite specifically ==="
.venv/bin/python - <<'PY'
import os
from app.core.environment import validate_runtime_settings

try:
    validate_runtime_settings(
        environment="staging",
        database_url="sqlite+aiosqlite:///./nope.db",
        public_base_url=os.environ["PUBLIC_BASE_URL"],
        secret_key=os.environ["SECRET_KEY"],
        auth_allow_header_user_id=False,
        allow_create_all=False,
        allow_demo_seed=False,
        redis_url=os.environ["REDIS_URL"],
        twilio_sid=os.environ["TWILIO_SID"],
        twilio_token=os.environ["TWILIO_TOKEN"],
        twilio_from=os.environ["TWILIO_FROM"],
    )
except ValueError as exc:
    message = str(exc)
    assert "SQLite запрещён" in message, message
else:
    raise SystemExit("staging policy accepted SQLite")
print("staging SQLite rejection OK")
PY


echo "=== 4) seed a customer and mint customer/admin Bearer tokens ==="
AUTH_JSON=$(.venv/bin/python - <<'PY'
import asyncio
import json
import os
import secrets
import uuid

from app.core.security import create_access_token
from app.db.session import SessionLocal
from app.models.entities import User, UserRole


async def main() -> None:
    user_id = str(uuid.uuid4())
    phone = f"+7999{secrets.randbelow(10_000_000):07d}"
    admin_id = os.environ["ADMIN_USER_IDS"]
    async with SessionLocal() as db:
        admin = await db.get(User, admin_id)
        if admin is None or admin.role != UserRole.contractor:
            raise SystemExit("verified admin fixture disappeared")
        db.add(
            User(
                id=user_id,
                phone=phone,
                role=UserRole.customer,
                full_name="Staging Runtime Smoke",
            )
        )
        await db.commit()
    print(
        json.dumps(
            {
                "id": user_id,
                "token": create_access_token(user_id),
                "admin_token": create_access_token(admin_id),
            }
        )
    )


asyncio.run(main())
PY
)
SMOKE_UID=$(printf '%s' "$AUTH_JSON" | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')
SMOKE_TOKEN=$(printf '%s' "$AUTH_JSON" | python3 -c 'import json,sys; print(json.load(sys.stdin)["token"])')
ADMIN_TOKEN=$(printf '%s' "$AUTH_JSON" | python3 -c 'import json,sys; print(json.load(sys.stdin)["admin_token"])')
test -n "$SMOKE_UID"
test -n "$SMOKE_TOKEN"
test -n "$ADMIN_TOKEN"
echo "Bearer fixtures ready"


echo "=== 5) start staging API :$API_PORT ==="
cleanup
rm -f "$LOG_FILE" "$HEALTH_FILE" "$HEADER_AUTH_FILE" "$OCR_FORBIDDEN_FILE" "$OCR_FILE" "$H0_FILE"
nohup .venv/bin/uvicorn app.main:app \
  --host 127.0.0.1 \
  --port "$API_PORT" \
  --log-level warning \
  >"$LOG_FILE" 2>&1 &
echo $! >"$PID_FILE"

for i in $(seq 1 60); do
  if curl -sf "http://127.0.0.1:$API_PORT/health" >"$HEALTH_FILE"; then
    break
  fi
  if ! kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    echo "FAIL: API process exited during startup" >&2
    tail -100 "$LOG_FILE" || true
    exit 1
  fi
  sleep 0.5
  if [ "$i" -eq 60 ]; then
    echo "FAIL: API did not become healthy" >&2
    tail -100 "$LOG_FILE" || true
    exit 1
  fi
done

python3 - <<'PY'
import json

with open("/tmp/renova-staging-postgres-health.json", encoding="utf-8") as handle:
    payload = json.load(handle)
assert payload.get("status") == "ok", payload
assert payload.get("environment") == "staging", payload
print("health environment=staging OK")
PY


echo "=== 6) prove header identity is rejected in staging ==="
HEADER_STATUS=$(curl -sS \
  -o "$HEADER_AUTH_FILE" \
  -w '%{http_code}' \
  "http://127.0.0.1:$API_PORT/api/v1/ocr/worker" \
  -H "X-User-Id: $SMOKE_UID")
if [ "$HEADER_STATUS" != "401" ]; then
  echo "FAIL: X-User-Id returned HTTP $HEADER_STATUS, expected 401" >&2
  cat "$HEADER_AUTH_FILE" >&2 || true
  exit 1
fi
echo "header identity rejected OK"


echo "=== 7) prove customer Bearer cannot inspect global OCR queue ==="
OCR_FORBIDDEN_STATUS=$(curl -sS \
  -o "$OCR_FORBIDDEN_FILE" \
  -w '%{http_code}' \
  "http://127.0.0.1:$API_PORT/api/v1/ocr/worker" \
  -H "Authorization: Bearer $SMOKE_TOKEN")
if [ "$OCR_FORBIDDEN_STATUS" != "403" ]; then
  echo "FAIL: customer OCR worker status returned HTTP $OCR_FORBIDDEN_STATUS, expected 403" >&2
  cat "$OCR_FORBIDDEN_FILE" >&2 || true
  exit 1
fi
python3 - "$OCR_FORBIDDEN_FILE" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    payload = json.load(handle)
assert payload.get("detail", {}).get("code") == "admin_role_forbidden", payload
assert "queued_version_ids" not in payload, payload
print("customer global OCR access rejected without queue disclosure")
PY


echo "=== 8) exercise OCR status with admin Bearer JWT ==="
curl -sf \
  "http://127.0.0.1:$API_PORT/api/v1/ocr/worker" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  >"$OCR_FILE"
python3 - <<'PY'
import json

with open("/tmp/renova-staging-ocr-worker.json", encoding="utf-8") as handle:
    payload = json.load(handle)
assert payload.get("mode") == "metadata", payload
assert payload.get("source") == "metadata", payload
assert payload.get("engine_available") is False, payload
assert payload.get("content_read") is False, payload
assert payload.get("background_worker_enabled") is False, payload
assert isinstance(payload.get("queued_count"), int), payload
print("admin Bearer OCR metadata contract OK")
PY


echo "=== 9) verify database-backed H0 admin readiness with admin Bearer JWT ==="
curl -sf \
  "http://127.0.0.1:$API_PORT/api/v1/admin/h0-readiness" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  >"$H0_FILE"
python3 - "$H0_FILE" "$ADMIN_ID" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    payload = json.load(handle)
admin_id = sys.argv[2]
checks = {item.get("id"): item for item in payload.get("checks", [])}
admin = checks.get("admin_identity", {})
assert admin.get("ok") is True, payload
assert admin.get("database_checked") is True, payload
assert admin.get("database_ok") is True, payload
assert admin.get("configured_count") == 1, payload
assert admin.get("valid_contractor_count") == 1, payload
assert admin.get("missing_count") == 0, payload
assert admin.get("wrong_role_count") == 0, payload
assert admin_id not in json.dumps(payload, ensure_ascii=False), payload
print("H0 admin identity database contract OK")
PY


echo ""
echo "staging-postgres-smoke: PASS"
echo "  health: http://127.0.0.1:$API_PORT/health"
echo "  dependencies: PostgreSQL :5435, Redis :6381"
echo "  cleanup: docker compose -f docker-compose.staging.yml down"
