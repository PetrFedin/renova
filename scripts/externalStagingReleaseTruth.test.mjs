import { readFileSync } from 'node:fs';

const src = (path) => readFileSync(path, 'utf8');
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const contains = (text, token, message) => assert(text.includes(token), message);
const excludes = (text, token, message) => assert(!text.includes(token), message);

const smoke = src('scripts/external-staging-release-smoke.sh');
for (const [token, message] of [
  ['EXPECTED_RELEASE_SHA', 'external staging must bind a Git SHA'],
  ['EXPECTED_IMAGE_DIGEST', 'external staging must bind an immutable image digest'],
  ['^sha256:[0-9a-f]{64}$', 'external staging must validate sha256 digest shape'],
  ['API_BASE must use https://', 'external staging must require TLS'],
  ['API_BASE is placeholder/local', 'external staging must reject placeholder/local endpoints'],
  ['Authorization: Bearer $TOKEN', 'external staging protected checks must use Bearer auth'],
  ['$API_BASE/health', 'external staging must check liveness'],
  ['$API_BASE/ready', 'external staging must check readiness'],
  ['$API_BASE/api/v1/admin/h0-readiness', 'external staging must check protected H0 readiness'],
  ['$API_BASE/api/v1/admin/release-health', 'external staging must check release health'],
  ['health.get("release") == expected_sha', 'health must prove the expected Git SHA'],
  ['health.get("artifact_digest") == expected_digest', 'health must prove the expected image digest'],
  ['ready.get("artifact_digest") == expected_digest', 'readiness must prove the expected image digest'],
]) {
  contains(smoke, token, message);
}
for (const forbidden of ['/api/v1/auth/demo', 'X-User-Id', 'H0_USER_ID']) {
  excludes(smoke, forbidden, `external staging must not use retired identity fallback: ${forbidden}`);
}

const workflow = src('.github/workflows/external-staging-release.yml');
for (const [token, message] of [
  ['workflow_dispatch:', 'external staging must be an explicit controlled release action'],
  ['environment: staging', 'external staging must use the protected GitHub staging environment'],
  ['vars.STAGING_API_BASE_URL', 'external staging must read the environment-scoped API URL'],
  ['secrets.STAGING_ADMIN_BEARER_TOKEN', 'external staging must read an environment-scoped admin Bearer token'],
  ['inputs.release_sha', 'external staging must receive an explicit release SHA'],
  ['inputs.image_digest', 'external staging must receive an explicit image digest'],
  ['bash scripts/external-staging-release-smoke.sh', 'external staging workflow must run the canonical remote smoke'],
  ['node scripts/externalStagingReleaseTruth.test.mjs', 'PR CI must protect the external staging workflow itself'],
]) {
  contains(workflow, token, message);
}
excludes(workflow, ':latest', 'external staging workflow must not reference mutable latest image tags');
excludes(workflow, '--latest', 'external staging workflow must not promote or submit mutable latest artifacts');

const main = src('backend/app/main.py');
const observability = src('backend/app/core/observability.py');
contains(observability, 'RENOVA_IMAGE_DIGEST', 'canonical release helper must read deployment-supplied immutable digest');
contains(observability, 'RENOVA_GIT_SHA', 'canonical release helper must read deployment-supplied Git SHA');
contains(main, 'release_digest()', 'runtime must use canonical immutable digest helper');
contains(main, '"artifact_digest": release_digest()', 'health/readiness must expose the artifact digest');
contains(main, '"release": release_sha()', 'health/readiness must expose the exact Git SHA');

console.log('externalStagingReleaseTruth.test OK');
