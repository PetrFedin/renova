#!/usr/bin/env bash
# Staging/production credentials probe. Development: warns only (exit 0 unless STRICT=1).
# Mirrors backend/app/core/environment.py policy for ops before deploy.
set -euo pipefail
cd "$(dirname "$0")/.."

ENV_FILE="${ENV_FILE:-backend/.env}"
# Pass ENV_FILE=/dev/null to ignore local .env (CI / synthetic checks).
if [[ -n "$ENV_FILE" && "$ENV_FILE" != "/dev/null" && -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE" 2>/dev/null || true
  set +a
fi

env_name="$(echo "${ENVIRONMENT:-development}" | tr '[:upper:]' '[:lower:]')"
case "$env_name" in
  dev|local) env_name=development ;;
  stage|stg) env_name=staging ;;
  prod|prd) env_name=production ;;
esac

strict=0
if [[ "$env_name" == "staging" || "$env_name" == "production" || "${STRICT:-0}" == "1" ]]; then
  strict=1
fi

fail=0
warn=0
report=()

need() {
  # Indirect expand: ${!k-} is NOT valid for "default if unset" on nameref.
  local k="$1"
  local v="${!k}"
  if [[ -z "${v}" ]]; then
    if [[ "$strict" -eq 1 ]]; then
      report+=("FAIL required $k empty")
      fail=1
    else
      report+=("WARN $k empty (ok in development)")
      warn=1
    fi
  else
    report+=("OK $k set")
  fi
}

is_truthy() {
  case "${1:-}" in
    1|true|TRUE|yes|YES|on|ON) return 0 ;;
    *) return 1 ;;
  esac
}

need PUBLIC_BASE_URL
need SECRET_KEY
need YOOKASSA_WEBHOOK_SECRET
need CORS_ALLOWED_ORIGINS
need REDIS_URL
need SENTRY_DSN
need DATABASE_URL

base="${PUBLIC_BASE_URL-}"
db="${DATABASE_URL-}"
secret="${SECRET_KEY-}"

DEFAULT_SECRETS=(
  "dev-secret-change-me"
  "change-me"
  "changeme"
  "secret"
  "password"
)

if [[ "$strict" -eq 1 ]]; then
  if [[ "$base" != https://* ]]; then
    report+=("FAIL PUBLIC_BASE_URL must be https:// (got: ${base:-empty})")
    fail=1
  else
    report+=("OK PUBLIC_BASE_URL is https")
  fi

  base_l="$(echo "$base" | tr '[:upper:]' '[:lower:]')"
  if [[ "$base_l" == *"://127.0.0.1"* || "$base_l" == *"://localhost"* || "$base_l" == *"://0.0.0.0"* || "$base_l" == *"://[::1]"* ]]; then
    report+=("FAIL PUBLIC_BASE_URL must not be localhost")
    fail=1
  else
    report+=("OK PUBLIC_BASE_URL not localhost")
  fi

  if [[ "${CORS_ALLOWED_ORIGINS-}" == "*" ]]; then
    report+=("FAIL CORS_ALLOWED_ORIGINS must not be *")
    fail=1
  else
    report+=("OK CORS_ALLOWED_ORIGINS not wildcard")
  fi

  # Policy: X-User-Id header identity forbidden on staging/production
  if is_truthy "${AUTH_ALLOW_HEADER_USER_ID-}"; then
    report+=("FAIL AUTH_ALLOW_HEADER_USER_ID=true forbidden (Bearer JWT only)")
    fail=1
  else
    report+=("OK AUTH_ALLOW_HEADER_USER_ID not forced on (policy: Bearer only)")
  fi

  db_l="$(echo "$db" | tr '[:upper:]' '[:lower:]')"
  if [[ "$db_l" == sqlite* ]]; then
    report+=("FAIL DATABASE_URL must not be sqlite on staging/production")
    fail=1
  else
    report+=("OK DATABASE_URL is not sqlite")
  fi

  secret_bad=0
  for d in "${DEFAULT_SECRETS[@]}"; do
    if [[ "$secret" == "$d" ]]; then
      secret_bad=1
      break
    fi
  done
  if [[ "$secret_bad" -eq 1 || ${#secret} -lt 16 ]]; then
    report+=("FAIL SECRET_KEY is default or too short (<16)")
    fail=1
  else
    report+=("OK SECRET_KEY looks non-default")
  fi
fi

if is_truthy "${ALLOW_ACCOUNT_PURGE-}"; then
  report+=("WARN ALLOW_ACCOUNT_PURGE is enabled")
  warn=1
fi

if is_truthy "${ALLOW_DEMO_SEED-}" && [[ "$strict" -eq 1 ]]; then
  report+=("FAIL ALLOW_DEMO_SEED must be off on staging/production")
  fail=1
fi

echo "=== staging credentials probe (env=$env_name strict=$strict) ==="
printf '%s\n' "${report[@]}"
echo "=== summary fail=$fail warn=$warn ==="

if [[ -n "${STAGING_PROBE_OUT:-}" ]]; then
  python3 -c "import json,pathlib,sys; pathlib.Path(sys.argv[1]).write_text(json.dumps({'env':sys.argv[2],'fail':int(sys.argv[3]),'warn':int(sys.argv[4]),'lines':sys.argv[5:]},ensure_ascii=False,indent=2)+'\n')" \
    "$STAGING_PROBE_OUT" "$env_name" "$fail" "$warn" "${report[@]}"
  echo "wrote $STAGING_PROBE_OUT"
fi

[[ "$fail" -eq 0 ]] || exit 1
exit 0
