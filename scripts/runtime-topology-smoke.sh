#!/usr/bin/env bash
# Same-image staging-policy topology proof: two API replicas + one worker.
set -euo pipefail

IMAGE="${RUNTIME_TOPOLOGY_IMAGE:-renova-backend:topology-ci}"
SUFFIX="${GITHUB_RUN_ID:-$$}-${RANDOM}"
NETWORK="renova-topology-${SUFFIX}"
PG="renova-topology-pg-${SUFFIX}"
REDIS="renova-topology-redis-${SUFFIX}"
API_A="renova-topology-api-a-${SUFFIX}"
API_B="renova-topology-api-b-${SUFFIX}"
WORKER="renova-topology-worker-${SUFFIX}"
PG_IMAGE="postgres:17-alpine@sha256:18cfe3ef5e6815560c98237d6216d1e5119702fb0f3894c8785dd58b8bbe5d73"
REDIS_IMAGE="redis:7-alpine"
DATABASE_URL="postgresql+asyncpg://renova:renova@${PG}:5432/renova_topology"
REDIS_URL="redis://${REDIS}:6379/0"
SECRET_KEY="runtime-topology-ci-secret-at-least-32-chars"
API_A_PORT="${RUNTIME_TOPOLOGY_API_A_PORT:-18111}"
API_B_PORT="${RUNTIME_TOPOLOGY_API_B_PORT:-18112}"
API_A_LOG="/tmp/renova-runtime-topology-api-a.log"
API_B_LOG="/tmp/renova-runtime-topology-api-b.log"
WORKER_LOG="/tmp/renova-runtime-topology-worker.log"

capture_logs() {
  docker logs "$API_A" >"$API_A_LOG" 2>&1 || true
  docker logs "$API_B" >"$API_B_LOG" 2>&1 || true
  docker logs "$WORKER" >"$WORKER_LOG" 2>&1 || true
  docker logs "$PG" > /tmp/renova-runtime-topology-postgres.log 2>&1 || true
  docker logs "$REDIS" > /tmp/renova-runtime-topology-redis.log 2>&1 || true
}

cleanup() {
  capture_logs
  docker rm -f "$API_A" "$API_B" "$WORKER" "$PG" "$REDIS" >/dev/null 2>&1 || true
  docker network rm "$NETWORK" >/dev/null 2>&1 || true
}
trap cleanup EXIT

wait_container_health() {
  local name="$1"
  for _ in $(seq 1 60); do
    local running health
    running="$(docker inspect --format '{{.State.Running}}' "$name" 2>/dev/null || echo false)"
    health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$name" 2>/dev/null || echo missing)"
    if [ "$running" = "true" ] && [ "$health" = "healthy" ]; then
      return 0
    fi
    if [ "$running" != "true" ]; then
      echo "FAIL: $name exited before becoming healthy" >&2
      docker logs "$name" >&2 || true
      return 1
    fi
    sleep 1
  done
  echo "FAIL: $name did not become healthy" >&2
  docker logs "$name" >&2 || true
  return 1
}

redis_key_count() {
  local pattern="$1"
  docker exec "$REDIS" redis-cli --raw --scan --pattern "$pattern" \
    | awk 'NF {count += 1} END {print count + 0}'
}

worker_key_count() {
  redis_key_count 'renova:runtime:worker:*'
}

api_key_count() {
  redis_key_count 'renova:runtime:api:*'
}

common_env=(
  -e ENVIRONMENT=staging
  -e DATABASE_URL="$DATABASE_URL"
  -e REDIS_URL="$REDIS_URL"
  -e PUBLIC_BASE_URL=https://api-staging.renova.invalid
  -e SECRET_KEY="$SECRET_KEY"
  -e ADMIN_USER_IDS=runtime-topology-admin
  -e ALLOW_CREATE_ALL=false
  -e ALLOW_DEMO_SEED=false
  -e AUTH_ALLOW_HEADER_USER_ID=false
  -e DOCUMENT_OCR_MODE=metadata
  -e TWILIO_SID=AC00000000000000000000000000000000
  -e TWILIO_TOKEN=runtime-topology-provider-token
  -e TWILIO_FROM=+15005550006
  -e AUTOMATION_REMINDERS_ENABLED=true
  -e AUTOMATION_REMINDERS_INTERVAL_SEC=2
  -e PUSH_RECEIPT_WORKER_ENABLED=true
  -e PUSH_RECEIPT_WORKER_INTERVAL_SEC=2
)

echo "=== runtime topology: start PostgreSQL and Redis ==="
docker network create "$NETWORK" >/dev/null
docker run -d --name "$PG" --network "$NETWORK" \
  -e POSTGRES_USER=renova \
  -e POSTGRES_PASSWORD=renova \
  -e POSTGRES_DB=renova_topology \
  "$PG_IMAGE" >/dev/null
docker run -d --name "$REDIS" --network "$NETWORK" "$REDIS_IMAGE" \
  redis-server --save '' --appendonly no >/dev/null

for _ in $(seq 1 60); do
  if docker exec "$PG" pg_isready -U renova -d renova_topology >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
docker exec "$PG" pg_isready -U renova -d renova_topology >/dev/null
for _ in $(seq 1 30); do
  if docker exec "$REDIS" redis-cli ping 2>/dev/null | grep -qx PONG; then
    break
  fi
  sleep 1
done
docker exec "$REDIS" redis-cli ping | grep -qx PONG

echo "=== runtime topology: migrate once with the same image ==="
docker run --rm --network "$NETWORK" \
  "${common_env[@]}" \
  "$IMAGE" alembic upgrade head >/tmp/renova-runtime-topology-migrate.log 2>&1

echo "=== runtime topology: start two API replicas and one worker ==="
docker run -d --name "$API_A" --network "$NETWORK" -p "${API_A_PORT}:8100" \
  "${common_env[@]}" "$IMAGE" renova-api >/dev/null
docker run -d --name "$API_B" --network "$NETWORK" -p "${API_B_PORT}:8100" \
  "${common_env[@]}" "$IMAGE" renova-api >/dev/null
docker run -d --name "$WORKER" --network "$NETWORK" \
  "${common_env[@]}" "$IMAGE" renova-worker >/dev/null

wait_container_health "$API_A"
wait_container_health "$API_B"
wait_container_health "$WORKER"

curl -fsS "http://127.0.0.1:${API_A_PORT}/health" >/tmp/renova-runtime-topology-api-a.json
curl -fsS "http://127.0.0.1:${API_B_PORT}/health" >/tmp/renova-runtime-topology-api-b.json

docker exec "$API_A" sh -c 'test "$(cat /tmp/renova-runtime-role)" = api && test ! -e /tmp/renova-worker-heartbeat.json'
docker exec "$API_B" sh -c 'test "$(cat /tmp/renova-runtime-role)" = api && test ! -e /tmp/renova-worker-heartbeat.json'
docker exec "$WORKER" sh -c 'test "$(cat /tmp/renova-runtime-role)" = worker && test -s /tmp/renova-worker-heartbeat.json'

for _ in $(seq 1 10); do
  if [ "$(worker_key_count)" -eq 1 ] && [ "$(api_key_count)" -eq 2 ]; then
    break
  fi
  sleep 1
done
test "$(worker_key_count)" -eq 1
test "$(api_key_count)" -eq 2

# Avoid `docker logs | grep -q` under pipefail: once grep finds a match it may
# close the pipe while Docker is still writing, causing an unrelated SIGPIPE/141.
docker logs "$API_A" >"$API_A_LOG" 2>&1
docker logs "$API_B" >"$API_B_LOG" 2>&1
docker logs "$WORKER" >"$WORKER_LOG" 2>&1
grep -q 'ws redis bridge enabled' "$API_A_LOG"
grep -q 'ws redis bridge enabled' "$API_B_LOG"
grep -q 'renova worker started tasks=domain_outbox,automation_reminders,push_receipt_reconciliation' "$WORKER_LOG"
if grep -q 'ws redis bridge enabled' "$WORKER_LOG"; then
  echo "FAIL: worker started API-local websocket bridge" >&2
  exit 1
fi

echo "=== runtime topology: worker failure must not take APIs down ==="
docker stop -t 10 "$WORKER" >/dev/null
for _ in $(seq 1 10); do
  if [ "$(worker_key_count)" -eq 0 ]; then
    break
  fi
  sleep 1
done
test "$(worker_key_count)" -eq 0
test "$(api_key_count)" -eq 2
curl -fsS "http://127.0.0.1:${API_A_PORT}/ready" >/dev/null
curl -fsS "http://127.0.0.1:${API_B_PORT}/ready" >/dev/null
test "$(docker inspect --format '{{.State.Health.Status}}' "$API_A")" = healthy
test "$(docker inspect --format '{{.State.Health.Status}}' "$API_B")" = healthy

echo "=== runtime topology: restart worker and recover shared heartbeat ==="
docker start "$WORKER" >/dev/null
wait_container_health "$WORKER"
for _ in $(seq 1 10); do
  if [ "$(worker_key_count)" -eq 1 ]; then
    break
  fi
  sleep 1
done
test "$(worker_key_count)" -eq 1
test "$(api_key_count)" -eq 2

echo "=== runtime topology: one API failure must not take worker or peer API down ==="
docker stop -t 10 "$API_A" >/dev/null
for _ in $(seq 1 10); do
  if [ "$(api_key_count)" -eq 1 ]; then
    break
  fi
  sleep 1
done
test "$(api_key_count)" -eq 1
curl -fsS "http://127.0.0.1:${API_B_PORT}/ready" >/dev/null
test "$(docker inspect --format '{{.State.Health.Status}}' "$API_B")" = healthy
test "$(docker inspect --format '{{.State.Health.Status}}' "$WORKER")" = healthy
test "$(worker_key_count)" -eq 1

echo "runtime-topology-smoke: PASS"
