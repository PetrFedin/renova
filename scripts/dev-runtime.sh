#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${RENOVA_LOCAL_ENV_FILE:-${ROOT}/.env.local}"
ENV_EXAMPLE="${ROOT}/env.local.example"
COMPOSE_FILE="${ROOT}/docker-compose.yml"
API_URL="${RENOVA_LOCAL_API_URL:-http://127.0.0.1:8100}"
MINIO_HEALTH_URL="${RENOVA_LOCAL_MINIO_HEALTH_URL:-http://127.0.0.1:9000/minio/health/live}"
NODE_MAJOR="20"
PYTHON_VERSION="3.12.13"
POETRY_VERSION="2.4.1"

log() { printf '[renova-dev] %s\n' "$*"; }
fail() { printf '[renova-dev] ERROR: %s\n' "$*" >&2; exit 2; }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "missing prerequisite: $1"
}

ensure_env_file() {
  if [ ! -f "$ENV_FILE" ]; then
    [ -f "$ENV_EXAMPLE" ] || fail "missing ${ENV_EXAMPLE}"
    cp "$ENV_EXAMPLE" "$ENV_FILE"
    log "created local-only env: ${ENV_FILE}"
  fi
}

load_local_env() {
  ensure_env_file
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a

  case "${ENVIRONMENT:-}" in
    development|dev|local) ;;
    *) fail "dev runtime refuses ENVIRONMENT=${ENVIRONMENT:-<empty>}; use only development" ;;
  esac

  case "${DATABASE_URL:-}" in
    *127.0.0.1*|*localhost*) ;;
    *) fail "local DATABASE_URL must target localhost/127.0.0.1" ;;
  esac
  case "${REDIS_URL:-}" in
    redis://127.0.0.1:*|redis://localhost:*) ;;
    *) fail "local REDIS_URL must target localhost/127.0.0.1" ;;
  esac
  case "${S3_ENDPOINT:-}" in
    http://127.0.0.1:*|http://localhost:*) ;;
    *) fail "local S3_ENDPOINT must target localhost/127.0.0.1" ;;
  esac
  case "${PUBLIC_BASE_URL:-}" in
    http://127.0.0.1:*|http://localhost:*) ;;
    *) fail "local PUBLIC_BASE_URL must target localhost/127.0.0.1" ;;
  esac

  [ "${ALLOW_CREATE_ALL:-}" = "false" ] || fail "local runtime requires ALLOW_CREATE_ALL=false; schema is Alembic-only"
  [ "${ALLOW_DEMO_SEED:-}" = "true" ] || fail "local runtime requires ALLOW_DEMO_SEED=true"
  [ "${AUTH_ALLOW_HEADER_USER_ID:-}" = "true" ] || fail "local runtime requires AUTH_ALLOW_HEADER_USER_ID=true"
  [ "${EXPO_PUBLIC_APP_ENV:-}" = "development" ] || fail "EXPO_PUBLIC_APP_ENV must be development"
  [ "${EXPO_PUBLIC_API_URL:-}" = "$API_URL" ] || fail "EXPO_PUBLIC_API_URL must match ${API_URL}"
}

compose() {
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

python_cmd() {
  if command -v python3 >/dev/null 2>&1; then
    printf '%s\n' python3
  elif command -v python >/dev/null 2>&1; then
    printf '%s\n' python
  else
    fail "missing prerequisite: Python ${PYTHON_VERSION}"
  fi
}

doctor() {
  load_local_env
  require_cmd docker
  require_cmd node
  require_cmd npm
  require_cmd poetry
  require_cmd curl
  docker compose version >/dev/null

  local node_major
  node_major="$(node -p 'process.versions.node.split(".")[0]')"
  [ "$node_major" = "$NODE_MAJOR" ] || fail "Node ${NODE_MAJOR}.x required (CI contract); found $(node --version)"

  local py
  py="$(python_cmd)"
  local py_version
  py_version="$($py -c 'import platform; print(platform.python_version())')"
  [ "$py_version" = "$PYTHON_VERSION" ] || fail "Python ${PYTHON_VERSION} required (CI contract); found ${py_version}"

  poetry --version | grep -F "${POETRY_VERSION}" >/dev/null || fail "Poetry ${POETRY_VERSION} required; found $(poetry --version)"
  [ -f "$ROOT/package-lock.json" ] || fail "package-lock.json missing"
  [ -f "$ROOT/backend/poetry.lock" ] || fail "backend/poetry.lock missing"
  [ -f "$ROOT/backend/.python-version" ] || fail "backend/.python-version missing"

  log "prerequisites OK: Node ${NODE_MAJOR}.x, Python ${PYTHON_VERSION}, Poetry ${POETRY_VERSION}, Docker Compose"
}

validate_dependencies() {
  [ -d "$ROOT/node_modules" ] || fail "node_modules missing; run: npm run dev -- bootstrap"
  [ -x "$ROOT/backend/.venv/bin/python" ] || fail "backend/.venv missing; run: npm run dev -- bootstrap"
  (
    cd "$ROOT/backend"
    POETRY_VIRTUALENVS_IN_PROJECT=true poetry check --lock
    POETRY_VIRTUALENVS_IN_PROJECT=true poetry run python -m pip check
  )
  log "locked dependency environment OK"
}

bootstrap() {
  doctor
  log "installing exact npm workspace lock"
  (cd "$ROOT" && npm ci)
  log "syncing exact backend Poetry lock"
  (
    cd "$ROOT/backend"
    POETRY_VIRTUALENVS_IN_PROJECT=true poetry check --lock
    POETRY_VIRTUALENVS_IN_PROJECT=true poetry sync --no-interaction
    POETRY_VIRTUALENVS_IN_PROJECT=true poetry run python -m pip check
  )
  log "bootstrap complete; startup never performs ad-hoc package installation"
}

wait_for_infra() {
  local i
  for i in $(seq 1 60); do
    if compose exec -T postgres pg_isready -U renova -d renova >/dev/null 2>&1 \
      && compose exec -T redis redis-cli ping 2>/dev/null | grep -q '^PONG$' \
      && curl -fsS "$MINIO_HEALTH_URL" >/dev/null 2>&1; then
      log "infra healthy: PostgreSQL, Redis, MinIO"
      return 0
    fi
    sleep 2
  done
  compose ps >&2 || true
  fail "local infrastructure did not become healthy"
}

wait_for_runtime() {
  local i
  for i in $(seq 1 60); do
    if curl -fsS "${API_URL}/health" >/dev/null 2>&1 \
      && curl -fsS "${API_URL}/ready" >/dev/null 2>&1 \
      && compose exec -T worker python -m app.runtime_healthcheck >/dev/null 2>&1; then
      log "runtime healthy: API /health + /ready, worker heartbeat"
      return 0
    fi
    sleep 2
  done
  compose ps >&2 || true
  compose logs --tail=120 api worker >&2 || true
  fail "API/worker runtime did not become healthy"
}

infra() {
  load_local_env
  compose up -d postgres redis minio
  wait_for_infra
}

migrate_and_preflight() {
  log "running fail-fast Alembic upgrade"
  compose run --rm migrate
  log "verifying database is exactly at bundled Alembic head"
  compose run --rm --no-deps api python -m app.db.migration_guard
  log "running canonical runtime-service preflight (deployment-only admin identity gate excluded locally)"
  compose run --rm --no-deps api python -m app.core.runtime_preflight --skip-database
}

backend_up() {
  infra
  migrate_and_preflight
  compose up -d api worker
  wait_for_runtime
}

check() {
  load_local_env
  local failed=0

  printf '\nRenova local runtime status\n'
  if compose exec -T postgres pg_isready -U renova -d renova >/dev/null 2>&1; then
    printf 'OK   PostgreSQL 127.0.0.1:5433\n'
  else
    printf 'FAIL PostgreSQL\n' >&2; failed=1
  fi

  if compose exec -T redis redis-cli ping 2>/dev/null | grep -q '^PONG$'; then
    printf 'OK   Redis 127.0.0.1:6380\n'
  else
    printf 'FAIL Redis\n' >&2; failed=1
  fi

  if curl -fsS "$MINIO_HEALTH_URL" >/dev/null 2>&1; then
    printf 'OK   MinIO 127.0.0.1:9000\n'
  else
    printf 'FAIL MinIO\n' >&2; failed=1
  fi

  if curl -fsS "${API_URL}/health" >/dev/null 2>&1; then
    printf 'OK   API health %s/health\n' "$API_URL"
  else
    printf 'FAIL API health\n' >&2; failed=1
  fi

  if curl -fsS "${API_URL}/ready" >/dev/null 2>&1; then
    printf 'OK   API readiness %s/ready\n' "$API_URL"
  else
    printf 'FAIL API readiness\n' >&2; failed=1
  fi

  if compose exec -T api python -m app.db.migration_guard >/dev/null 2>&1; then
    printf 'OK   Alembic database=head\n'
  else
    printf 'FAIL Alembic database revision\n' >&2; failed=1
  fi

  if compose exec -T worker python -m app.runtime_healthcheck >/dev/null 2>&1; then
    printf 'OK   Worker local heartbeat\n'
  else
    printf 'FAIL Worker local heartbeat\n' >&2; failed=1
  fi

  if compose exec -T redis sh -ec 'test -n "$(redis-cli --scan --pattern "renova:runtime:worker:*" | head -n 1)"' >/dev/null 2>&1; then
    printf 'OK   Worker shared Redis heartbeat\n'
  else
    printf 'FAIL Worker shared Redis heartbeat\n' >&2; failed=1
  fi

  printf 'INFO Mobile API URL %s\n' "${EXPO_PUBLIC_API_URL}"
  [ "$failed" -eq 0 ] || return 2
}

seed() {
  load_local_env
  check >/dev/null
  compose exec -T api python -m app.dev_seed
}

logs() {
  load_local_env
  compose logs -f --tail=200 postgres redis minio api worker
}

stop() {
  ensure_env_file
  compose down --remove-orphans
}

reset() {
  load_local_env
  log "destroying LOCAL development volumes only"
  compose down -v --remove-orphans
  backend_up
  seed
  check
}

focused_tests() {
  doctor
  validate_dependencies
  check
  node "$ROOT/scripts/devRuntimeContract.test.mjs"
  (cd "$ROOT" && npm run test:offline && npm run test:routes)
  (
    cd "$ROOT/backend"
    ENVIRONMENT=test \
    DATABASE_URL=sqlite+aiosqlite:///./.dev-focused-tests.db \
    PUBLIC_BASE_URL=http://127.0.0.1:8100 \
    SECRET_KEY=renova-local-focused-test-secret \
    ALLOW_CREATE_ALL=true \
    ALLOW_DEMO_SEED=true \
    poetry run pytest -q \
      tests/test_environment_guards.py \
      tests/test_runtime_preflight_integrity.py \
      tests/test_database_revision_guard.py
  )
  rm -f "$ROOT/backend/.dev-focused-tests.db"
  log "focused tests passed"
}

full_tests() {
  focused_tests
  (
    cd "$ROOT/backend"
    ENVIRONMENT=test \
    DATABASE_URL=sqlite+aiosqlite:///./.dev-full-tests.db \
    PUBLIC_BASE_URL=http://127.0.0.1:8100 \
    SECRET_KEY=renova-local-full-test-secret \
    ALLOW_CREATE_ALL=true \
    ALLOW_DEMO_SEED=true \
    poetry run pytest -q
  )
  rm -f "$ROOT/backend/.dev-full-tests.db"
  (cd "$ROOT" && npm run typecheck:mobile && npm run mobile:test)
  log "full local regression passed; external staging/production remains separate evidence"
}

start() {
  doctor
  validate_dependencies
  backend_up
  check

  if [ "${RENOVA_DEV_NO_EXPO:-0}" = "1" ]; then
    log "backend topology ready; Expo intentionally skipped"
    return 0
  fi

  load_local_env
  export BROWSER="${BROWSER:-none}"
  log "starting Expo web with API ${EXPO_PUBLIC_API_URL}"
  cd "$ROOT/apps/mobile"
  exec npm run web -- --port "${EXPO_PORT:-8081}"
}

usage() {
  cat <<'EOF'
Usage: scripts/dev-runtime.sh <command>

  doctor        verify tools, exact versions, and local-only env
  bootstrap     install exact npm/Poetry lock environments explicitly
  infra         start PostgreSQL + Redis + MinIO and wait for health
  start         start full local topology; Expo stays foreground unless RENOVA_DEV_NO_EXPO=1
  check         verify infra, Alembic, API health/readiness, worker heartbeats, mobile API URL
  seed          run deterministic idempotent development seed
  reset         destroy LOCAL volumes, rebuild runtime, migrate, seed, and check
  logs          follow local runtime logs
  stop          stop local containers without deleting volumes
  test-focused  run runtime/source contracts and focused backend/mobile tests
  test-full     run focused tests, full backend pytest, mobile typecheck and contracts
EOF
}

case "${1:-}" in
  doctor) doctor ;;
  bootstrap) bootstrap ;;
  infra) doctor; infra ;;
  start) start ;;
  check) check ;;
  seed) seed ;;
  reset) doctor; validate_dependencies; reset ;;
  logs) logs ;;
  stop) stop ;;
  test-focused) focused_tests ;;
  test-full) full_tests ;;
  *) usage; exit 2 ;;
esac
