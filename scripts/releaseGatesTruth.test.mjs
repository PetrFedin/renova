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

const externalStaging = src('scripts/external-staging-release-smoke.sh');
contains(externalStaging, 'EXPECTED_RELEASE_SHA', 'external staging must bind an exact Git SHA');
contains(externalStaging, 'EXPECTED_IMAGE_DIGEST', 'external staging must bind an immutable image digest');
contains(externalStaging, 'EXPECTED_ENVIRONMENT="${EXPECTED_ENVIRONMENT:-staging}"', 'external staging must be environment-bound');
contains(externalStaging, 'API_BASE must use https://', 'external staging must require HTTPS');
contains(externalStaging, 'API_BASE is placeholder/local', 'external staging must reject placeholder/local origins');
contains(externalStaging, 'Authorization: Bearer $TOKEN', 'external staging must use Bearer auth for protected checks');
contains(externalStaging, 'health.get("release") == expected_sha', 'external staging health must match expected Git SHA');
contains(externalStaging, 'health.get("artifact_digest") == expected_digest', 'external staging health must match exact image digest');
contains(externalStaging, 'ready.get("artifact_digest") == expected_digest', 'external staging readiness must match exact image digest');
contains(externalStaging, 'worker_pool.get("healthy") is True', 'external staging must require a healthy background worker pool');
contains(externalStaging, 'worker_pool.get("current_release") == expected_sha', 'external staging worker pool must match the API release SHA');
contains(externalStaging, 'worker.get("artifact_digest") == expected_digest', 'external staging must prove at least one worker uses the promoted image digest');
contains(externalStaging, '"domain_outbox" in (worker.get("active_tasks") or [])', 'external staging must prove the worker owns durable outbox processing');
excludes(externalStaging, '/api/v1/auth/demo', 'external staging must never obtain demo auth');
excludes(externalStaging, 'X-User-Id', 'external staging must never use header identity fallback');

const externalStagingWorkflow = src('.github/workflows/external-staging-release.yml');
contains(externalStagingWorkflow, 'environment: staging', 'external staging verification must use a protected staging environment');
contains(externalStagingWorkflow, 'vars.STAGING_API_BASE_URL', 'external staging must use environment-scoped API origin');
contains(externalStagingWorkflow, 'secrets.STAGING_ADMIN_BEARER_TOKEN', 'external staging must use environment-scoped Bearer secret');
contains(externalStagingWorkflow, 'inputs.release_sha', 'external staging must receive explicit release SHA');
contains(externalStagingWorkflow, 'inputs.image_digest', 'external staging must receive explicit image digest');
contains(externalStagingWorkflow, 'bash scripts/external-staging-release-smoke.sh', 'external staging workflow must execute canonical smoke');
excludes(externalStagingWorkflow, ':latest', 'external staging must not use mutable latest image tags');
excludes(externalStagingWorkflow, '--latest', 'external staging must not promote mutable latest artifacts');

const main = src('backend/app/main.py');
const workerMain = src('backend/app/worker_main.py');
const observability = src('backend/app/core/observability.py');
contains(observability, 'RENOVA_IMAGE_DIGEST', 'release helper must read deployment-supplied image digest');
contains(observability, 'RENOVA_GIT_SHA', 'release helper must read immutable Git SHA');
contains(main, 'release_digest()', 'runtime probes must expose deployment-supplied image digest through canonical helper');
contains(main, '"artifact_digest": release_digest()', 'runtime probes must include exact image digest');
contains(main, '"release": release_sha()', 'runtime probes must include exact Git SHA');
contains(main, '"background_runtime": "renova-worker"', 'API health must disclose the dedicated background runtime');
excludes(main, 'outbox_worker_loop', 'API process must not own durable outbox processing');
contains(workerMain, 'outbox_worker_loop', 'worker process must own durable outbox processing');

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
contains(preflight, 'bash ../../scripts/eas-cli.sh whoami', 'TestFlight preflight must verify EAS identity through the exact wrapper');
contains(preflight, 'bash ../../scripts/eas-cli.sh project:info', 'TestFlight preflight must verify EAS project access through the exact wrapper');
excludes(preflight, 'eas-cli@latest', 'TestFlight preflight must not use a mutable EAS CLI');

const easWrapper = src('scripts/eas-cli.sh');
contains(easWrapper, 'EAS_CLI_VERSION="21.4.0"', 'EAS wrapper must pin the reviewed CLI version');
contains(easWrapper, 'npx --yes "eas-cli@${EAS_CLI_VERSION}"', 'EAS wrapper must execute the exact CLI package');
excludes(easWrapper, 'eas-cli@latest', 'EAS wrapper must not use the mutable latest tag');

const eas = src('.github/workflows/eas-build.yml');
excludes(eas, '--no-wait', 'EAS workflow must not pass after merely triggering a cloud build');
contains(eas, '--wait', 'EAS build/submit workflow must wait for terminal outcome');
contains(eas, 'EXPO_TOKEN is required; a release workflow may not pass without starting EAS', 'EAS workflow must fail without Expo token');
contains(eas, 'testflight profile is iOS-only', 'EAS workflow must reject invalid TestFlight platform');
contains(eas, 'preview is internal distribution and cannot be submitted', 'EAS workflow must reject preview submission');
contains(eas, '--platform "${{ inputs.platform }}"', 'EAS build must use selected platform');
contains(eas, 'bash ../../scripts/eas-cli.sh build', 'EAS build must use the exact shared wrapper');
contains(eas, '--json', 'EAS workflow must capture structured build identity');
contains(eas, 'bash ../../scripts/eas-cli.sh submit', 'EAS submit must use the exact shared wrapper');
contains(eas, '--id "$build_id"', 'EAS submit must target the exact build ID returned by the build step');
excludes(eas, 'eas-cli@latest', 'EAS workflow must not use a mutable EAS CLI');
excludes(eas, '--latest', 'EAS workflow must not submit a mutable latest build');

console.log('releaseGatesTruth.test OK');
