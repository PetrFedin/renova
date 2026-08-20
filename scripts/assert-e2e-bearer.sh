#!/usr/bin/env bash
# Fail if Playwright specs hardcode X-User-Id and bootstrap the production-auth
# load/SLO source contract through the existing aggregate CI workflow.
# The dedicated path-scoped Load SLO workflow becomes the primary focused gate
# once it exists on the default branch.
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

# New workflows added by a PR cannot be treated as sufficient first-merge proof.
# Validate the same load contract from this existing CI path so the exact PR head
# proves both source integrity and that the immutable k6 runtime is pullable/parses
# every canonical scenario.
node --test scripts/loadSloIntegrity.test.mjs
bash -n scripts/external-load-reconciliation.sh

k6_image="$(tr -d '\r\n' < load/K6_IMAGE)"
if [[ ! "$k6_image" =~ ^grafana/k6:2\.1\.0@sha256:[0-9a-f]{64}$ ]]; then
  echo "FAIL: load/K6_IMAGE is not the reviewed immutable k6 v2.1.0 reference" >&2
  exit 1
fi

docker run --rm "$k6_image" version
for script in k6-smoke.js k6-journey.js k6-load.js k6-spike.js k6-soak.js; do
  docker run --rm \
    -v "$PWD/load:/scripts:ro" \
    -e API_BASE_URL=https://load-contract.invalid \
    -e RENOVA_LOAD_TOKEN_POOL='[{"token":"ci-contract-token"}]' \
    "$k6_image" inspect "/scripts/$script" >/dev/null
done

echo "OK production-auth load/SLO bootstrap contract"
