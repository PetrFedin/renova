#!/usr/bin/env bash
# Generate Staging Readiness Report with commit SHA (H0 / audit #3).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SHA="$(git -C "$ROOT" rev-parse HEAD)"
SHORT="$(git -C "$ROOT" rev-parse --short HEAD)"
API_BASE="${API_BASE:-http://127.0.0.1:8100}"
OUT="$ROOT/docs/STAGING-READINESS-REPORT-${SHORT}.md"
TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

echo "Fetching H0 readiness from ${API_BASE}…"
BODY="$(curl -fsS "${API_BASE}/api/v1/admin/h0-readiness" -H "Authorization: Bearer ${TOKEN:-}" -H "X-User-Id: ${USER_ID:-}" 2>/dev/null || echo '{"error":"unreachable"}')"

{
  echo "# Staging Readiness Report"
  echo
  echo "- checked_at: \`${TS}\`"
  echo "- git_sha: \`${SHA}\`"
  echo "- api_base: \`${API_BASE}\`"
  echo
  echo "## Raw H0 payload"
  echo
  echo '```json'
  echo "${BODY}" | python3 -m json.tool 2>/dev/null || echo "${BODY}"
  echo '```'
} > "$OUT"

echo "Wrote $OUT"
