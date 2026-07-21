#!/usr/bin/env bash
# Generate Staging Readiness Report with commit SHA (H0 / audit #3).
# Auth: JWT Bearer preferred (TOKEN / demo access_token). X-User-Id only as last resort.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SHA="$(git -C "$ROOT" rev-parse HEAD)"
SHORT="$(git -C "$ROOT" rev-parse --short HEAD)"
API_BASE="${API_BASE:-http://127.0.0.1:8100}"
OUT="$ROOT/docs/STAGING-READINESS-REPORT-${SHORT}.md"
TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

auth_args=()
if [[ -n "${TOKEN:-}" ]]; then
  auth_args=(-H "Authorization: Bearer ${TOKEN}")
elif [[ -n "${USER_ID:-}" ]]; then
  echo "WARN: USER_ID without TOKEN — staging may reject X-User-Id"
  auth_args=(-H "X-User-Id: ${USER_ID}")
else
  # Local/dev: mint demo JWT
  DEMO_JSON="$(curl -sf -X POST "${API_BASE}/api/v1/auth/demo" \
    -H "Content-Type: application/json" -d '{"role":"contractor"}' || true)"
  if [[ -n "$DEMO_JSON" ]]; then
    TOK="$(python3 -c "import json,sys; d=json.load(sys.stdin); print((d.get('access_token') or '').strip())" <<< "$DEMO_JSON")"
    UID="$(python3 -c "import json,sys; print(json.load(sys.stdin).get('id',''))" <<< "$DEMO_JSON")"
    if [[ -n "$TOK" ]]; then
      auth_args=(-H "Authorization: Bearer ${TOK}")
    elif [[ -n "$UID" ]]; then
      auth_args=(-H "X-User-Id: ${UID}")
    fi
  fi
fi

echo "Fetching H0 readiness from ${API_BASE}…"
if [[ ${#auth_args[@]} -eq 0 ]]; then
  BODY='{"error":"no_auth","hint":"set TOKEN=… Bearer JWT"}'
else
  BODY="$(curl -fsS "${API_BASE}/api/v1/admin/h0-readiness" "${auth_args[@]}" 2>/dev/null || echo '{"error":"unreachable"}')"
fi

{
  echo "# Staging Readiness Report"
  echo
  echo "- checked_at: \`${TS}\`"
  echo "- git_sha: \`${SHA}\`"
  echo "- api_base: \`${API_BASE}\`"
  echo "- auth: \`Bearer preferred\`"
  echo
  echo "## Raw H0 payload"
  echo
  echo '```json'
  echo "${BODY}" | python3 -m json.tool 2>/dev/null || echo "${BODY}"
  echo '```'
} > "$OUT"

echo "Wrote $OUT"

echo "=== Pilot credentials checklist (manual) ==="
echo "PUBLIC_BASE_URL must be https://…"
echo "YOOKASSA_WEBHOOK_SECRET set on staging"
echo "CORS_ALLOWED_ORIGINS allowlist (not *)"
echo "REDIS_URL for OTP + WS multi-instance"
echo "SENTRY_DSN (optional but recommended)"
echo "ALLOW_ACCOUNT_PURGE=false unless ops purge"
echo "AUTH_ALLOW_HEADER_USER_ID must not be true"

echo "=== credentials probe ==="
bash scripts/staging-credentials-probe.sh || true

echo "=== e2e Bearer assert ==="
bash scripts/assert-e2e-bearer.sh || true
