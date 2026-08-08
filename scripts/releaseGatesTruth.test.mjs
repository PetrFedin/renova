import { readFileSync } from 'node:fs';

const src = (path) => readFileSync(path, 'utf8');
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const contains = (text, token, message) => assert(text.includes(token), message);
const excludes = (text, token, message) => assert(!text.includes(token), message);

const merge = src('scripts/merge-readiness.sh');
contains(merge, 'API :8100 is unavailable; live E2E may not be skipped', 'merge gate must fail when API E2E cannot run');
contains(merge, 'mobile web :8081 is unavailable; UI E2E may not be skipped', 'merge gate must fail when UI E2E cannot run');
contains(merge, 'npm run e2e:portal-ui', 'merge gate must run portal UI E2E');
contains(merge, 'npm run e2e:contract-gate-ui', 'merge gate must run contract-gate UI E2E');
excludes(merge, 'SKIP:', 'merge gate must not report skipped required E2E as readiness');

const staging = src('scripts/staging-env-smoke.sh');
contains(staging, 'REQUIRE_REMOTE="${REQUIRE_REMOTE:-0}"', 'staging smoke must have explicit remote requirement');
contains(staging, 'PASS_CONFIG_ONLY (remote staging NOT VERIFIED)', 'config-only success must not imply staging verification');
contains(staging, 'remote staging verification required', 'remote-required mode must fail without API_BASE');
contains(staging, 'TOKEN is required when API_BASE is set', 'remote staging smoke must require Bearer token');
contains(staging, 'API_BASE is still a placeholder', 'remote staging smoke must reject placeholder domains');

const h0 = src('scripts/h0-check.sh');
contains(h0, 'if [[ "$STRICT" -eq 1 ]]; then LIVE=1; fi', 'strict H0 must imply live mode');
contains(h0, 'LIVE_TOKEN="${TOKEN:-${H0_TOKEN:-}}"', 'H0 must use an explicit Bearer token');
contains(h0, 'REQUIRE_REMOTE=1 REQUIRE_INVESTOR_READY="$INVESTOR_READY"', 'live H0 must require remote investor readiness');
contains(h0, 'Authorization: Bearer $LIVE_TOKEN', 'live H0 must authenticate with Bearer');
excludes(h0, '/api/v1/auth/demo', 'live H0 must never obtain demo auth');
excludes(h0, 'H0_USER_ID', 'live H0 must never accept X-User-Id fallback');
excludes(h0, 'X-User-Id', 'live H0 must never use header identity fallback');

const preflight = src('scripts/testflight-preflight.sh');
contains(preflight, 'v !== pkg.version', 'TestFlight preflight must tie app version to package version');
contains(preflight, 'example\\.com', 'TestFlight preflight must reject placeholder API URLs');
contains(preflight, 'expo.extra.eas.projectId', 'TestFlight preflight must require EAS project binding');
contains(preflight, 'EXPO_TOKEN is required', 'TestFlight preflight must require Expo auth');
contains(preflight, 'npx eas-cli@latest whoami', 'TestFlight preflight must verify EAS identity');
contains(preflight, 'npx eas-cli@latest project:info', 'TestFlight preflight must verify EAS project access');

const eas = src('.github/workflows/eas-build.yml');
excludes(eas, '--no-wait', 'EAS workflow must not pass after merely triggering a cloud build');
contains(eas, '--wait', 'EAS build/submit workflow must wait for terminal outcome');
contains(eas, 'EXPO_TOKEN is required; a release workflow may not pass without starting EAS', 'EAS workflow must fail without Expo token');
contains(eas, 'testflight profile is iOS-only', 'EAS workflow must reject invalid TestFlight platform');
contains(eas, 'preview is internal distribution and cannot be submitted', 'EAS workflow must reject preview submission');
contains(eas, '--platform "${{ inputs.platform }}"', 'EAS submit/build must use selected platform');

console.log('releaseGatesTruth.test OK');
