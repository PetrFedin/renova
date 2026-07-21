#!/usr/bin/env bash
# Fail if Playwright specs hardcode X-User-Id header (must use authHeaders / helpers).
# Uses grep/python — ripgrep is not installed on GitHub Actions runners by default.
set -euo pipefail
cd "$(dirname "$0")/.."

hits="$(grep -RIn -E "['\"]X-User-Id['\"]" e2e --include='*.spec.ts' || true)"
if [[ -n "$hits" ]]; then
  echo "FAIL: e2e specs must not hardcode X-User-Id — use authHeaders(DemoUser):"
  echo "$hits"
  exit 1
fi

if ! grep -q "export function authHeaders" e2e/helpers.ts; then
  echo "FAIL: e2e/helpers.ts missing authHeaders"
  exit 1
fi

echo "OK e2e specs use authHeaders (no raw X-User-Id in *.spec.ts)"
exit 0
