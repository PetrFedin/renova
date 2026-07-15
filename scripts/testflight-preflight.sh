#!/usr/bin/env bash
# Preflight before EAS TestFlight build. Exit 0 = repo ready; secrets/EAS account checked separately.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
CI_MODE=0
if [[ "${1:-}" == "--ci" ]]; then CI_MODE=1; fi

echo "=== TestFlight preflight (Renova v0.2) ==="

echo "--- 1) mobile unit tests ---"
npm run mobile:test

echo "--- 2) eas.json profiles ---"
node apps/mobile/lib/__tests__/easProfiles.test.mjs

echo "--- 3) app version / bundle id ---"
node - <<'NODE'
const fs = require('fs');
const app = JSON.parse(fs.readFileSync('apps/mobile/app.json', 'utf8'));
const v = app.expo?.version;
const bid = app.expo?.ios?.bundleIdentifier;
if (!v || !v.startsWith('0.2')) throw new Error(`expected expo.version 0.2.x, got ${v}`);
if (bid !== 'ru.renova.app') throw new Error(`unexpected bundleIdentifier: ${bid}`);
console.log(`OK: version=${v} bundle=${bid}`);
NODE

echo "--- 4) priority guards (backend) ---"
npm run test:guards

if [[ "$CI_MODE" -eq 0 ]]; then
  echo "--- 5) optional: EAS CLI ---"
  if command -v eas >/dev/null 2>&1 || npx eas --version >/dev/null 2>&1; then
    echo "EAS CLI available"
    if [[ -n "${EXPO_TOKEN:-}" ]]; then
      echo "EXPO_TOKEN set (local)"
    else
      echo "WARN: EXPO_TOKEN not set — CI/GitHub Actions build needs repo secret"
    fi
  else
    echo "WARN: eas cli not installed globally (npx eas works in CI)"
  fi
  echo "--- 6) optional: API e2e ---"
  if curl -sf --max-time 2 http://127.0.0.1:8100/health >/dev/null; then
    bash scripts/e2e-smoke.sh
  else
    echo "WARN: API :8100 down — skip live e2e"
  fi
else
  echo "--- 5) CI mode: skip EAS token / live e2e ---"
fi

echo "=== TestFlight preflight PASS ==="
