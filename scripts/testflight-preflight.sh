#!/usr/bin/env bash
# Fail-closed preflight before an EAS store/internal build.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

CI_MODE=0
PROFILE="testflight"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --ci)
      CI_MODE=1
      shift
      ;;
    --profile)
      PROFILE="${2:-}"
      if [[ -z "$PROFILE" ]]; then echo "FAIL: --profile requires a value" >&2; exit 2; fi
      shift 2
      ;;
    *)
      echo "FAIL: unsupported argument: $1" >&2
      exit 2
      ;;
  esac
done

case "$PROFILE" in
  testflight|preview|production|staging) ;;
  *) echo "FAIL: unsupported EAS profile: $PROFILE" >&2; exit 2 ;;
esac

echo "=== EAS preflight (profile=$PROFILE) ==="

echo "--- 1) mobile unit/domain tests ---"
npm run mobile:test

echo "--- 2) EAS profile contracts ---"
node apps/mobile/lib/__tests__/easProfiles.test.mjs


echo "--- 2b) selected profile API must be real HTTPS, not placeholder ---"
PROFILE="$PROFILE" node - <<'NODE'
const fs = require('fs');
const eas = JSON.parse(fs.readFileSync('apps/mobile/eas.json', 'utf8'));
const name = process.env.PROFILE;
const profile = eas.build?.[name];
if (!profile) throw new Error(`missing EAS build profile: ${name}`);
const url = profile.env?.EXPO_PUBLIC_API_URL || '';
if (!url.startsWith('https://')) throw new Error(`${name}: EXPO_PUBLIC_API_URL must use https (${url || 'empty'})`);
if (/localhost|127\.0\.0\.1|example\.com/i.test(url)) {
  throw new Error(`${name}: EXPO_PUBLIC_API_URL is local/placeholder (${url})`);
}
if (profile.env?.EXPO_PUBLIC_DEMO !== '0') throw new Error(`${name}: EXPO_PUBLIC_DEMO must be 0`);
if (!['staging', 'production'].includes(profile.env?.EXPO_PUBLIC_APP_ENV)) {
  throw new Error(`${name}: EXPO_PUBLIC_APP_ENV must be staging|production`);
}
console.log(`OK: ${name} -> ${url}`);
NODE

echo "--- 3) app version / bundle id / EAS project binding ---"
node - <<'NODE'
const fs = require('fs');
const app = JSON.parse(fs.readFileSync('apps/mobile/app.json', 'utf8'));
const pkg = JSON.parse(fs.readFileSync('apps/mobile/package.json', 'utf8'));
const v = app.expo?.version;
const bid = app.expo?.ios?.bundleIdentifier;
const projectId = app.expo?.extra?.eas?.projectId;
if (!v || v !== pkg.version) throw new Error(`app/package version mismatch: app=${v} package=${pkg.version}`);
if (bid !== 'ru.renova.app') throw new Error(`unexpected bundleIdentifier: ${bid}`);
if (!projectId || typeof projectId !== 'string') {
  throw new Error('EAS project is not linked: apps/mobile/app.json must contain expo.extra.eas.projectId');
}
console.log(`OK: version=${v} bundle=${bid} EAS project linked`);
NODE

echo "--- 4) priority backend guards ---"
npm run test:guards

echo "--- 5) EAS authentication — REQUIRED ---"
if [[ -z "${EXPO_TOKEN:-}" ]]; then
  echo "FAIL: EXPO_TOKEN is required for non-interactive EAS build/submit" >&2
  exit 1
fi

echo "--- 6) EAS CLI auth/project probe ---"
cd apps/mobile
npx eas-cli@latest project:info --non-interactive >/tmp/renova-eas-project-info.txt
cat /tmp/renova-eas-project-info.txt
cd "$ROOT"

if [[ "$CI_MODE" -eq 0 ]]; then
  echo "--- 7) local API E2E — REQUIRED for local release preflight ---"
  if ! curl -sf --max-time 2 http://127.0.0.1:8100/health >/dev/null; then
    echo "FAIL: API :8100 unavailable; local release preflight cannot skip E2E" >&2
    exit 1
  fi
  bash scripts/e2e-smoke.sh
else
  echo "--- 7) CI mode: local API E2E is provided by repository CI; EAS auth/project still verified above ---"
fi

echo "=== EAS preflight PASS: repository + profile + project binding + auth verified ==="
