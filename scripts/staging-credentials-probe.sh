#!/usr/bin/env bash
# Staging/production credentials probe. Development: warns only (exit 0 unless STRICT=1).
set -euo pipefail
cd "$(dirname "$0")/.."

ENV_FILE="${ENV_FILE:-backend/.env}"
if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE" 2>/dev/null || true
  set +a
fi

env_name="$(echo "${ENVIRONMENT:-development}" | tr '[:upper:]' '[:lower:]')"
strict=0
if [[ "$env_name" == "staging" || "$env_name" == "production" || "${STRICT:-0}" == "1" ]]; then
  strict=1
fi

fail=0
warn=0
report=()

need() {
  local k="$1" v="${!k-}"
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

need PUBLIC_BASE_URL
need SECRET_KEY
need YOOKASSA_WEBHOOK_SECRET
need CORS_ALLOWED_ORIGINS
need REDIS_URL
need SENTRY_DSN
need DATABASE_URL

base="${PUBLIC_BASE_URL-}"
if [[ "$strict" -eq 1 ]]; then
  if [[ "$base" != https://* ]]; then
    report+=("FAIL PUBLIC_BASE_URL must be https:// (got: ${base:-empty})")
    fail=1
  else
    report+=("OK PUBLIC_BASE_URL is https")
  fi
  if [[ "${CORS_ALLOWED_ORIGINS-}" == "*" ]]; then
    report+=("FAIL CORS_ALLOWED_ORIGINS must not be *")
    fail=1
  fi
fi

if [[ "${ALLOW_ACCOUNT_PURGE:-false}" == "true" || "${ALLOW_ACCOUNT_PURGE:-0}" == "1" ]]; then
  report+=("WARN ALLOW_ACCOUNT_PURGE is enabled")
  warn=1
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
