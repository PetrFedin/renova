#!/usr/bin/env bash
set -euo pipefail

API_BASE="${API_BASE:-}"
TOKEN="${TOKEN:-}"
EXPECTED_RELEASE_SHA="${EXPECTED_RELEASE_SHA:-}"
EXPECTED_IMAGE_DIGEST="${EXPECTED_IMAGE_DIGEST:-}"
OUT_DIR="${OUT_DIR:-/tmp/renova-load-slo}"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

[[ "$API_BASE" == https://* ]] || fail "API_BASE must use https://"
[[ -n "$TOKEN" ]] || fail "TOKEN is required"
[[ "$EXPECTED_RELEASE_SHA" =~ ^[0-9a-f]{40}$ ]] || fail "EXPECTED_RELEASE_SHA must be a 40-character lowercase Git SHA"
[[ "$EXPECTED_IMAGE_DIGEST" =~ ^sha256:[0-9a-f]{64}$ ]] || fail "EXPECTED_IMAGE_DIGEST must be an immutable sha256 digest"
API_BASE="${API_BASE%/}"
mkdir -p "$OUT_DIR"

release_file="$OUT_DIR/post-load-release-health.json"
summary_file="$OUT_DIR/post-load-reconciliation.json"

curl --fail-with-body --silent --show-error \
  --retry 3 --retry-delay 1 --connect-timeout 5 --max-time 20 \
  "$API_BASE/api/v1/admin/release-health" \
  -H "Authorization: Bearer $TOKEN" \
  >"$release_file"
python3 -m json.tool "$release_file" >/dev/null || fail "release-health did not return JSON"

python3 - "$release_file" "$summary_file" "$EXPECTED_RELEASE_SHA" "$EXPECTED_IMAGE_DIGEST" <<'PY'
import json
import sys
from pathlib import Path

release_path, summary_path, expected_sha, expected_digest = sys.argv[1:]
with open(release_path, encoding="utf-8") as handle:
    payload = json.load(handle)

release = payload.get("release") or {}
observability = payload.get("observability") or {}
artifact = observability.get("artifact") or {}
integrations = payload.get("integrations") or {}
outbox = integrations.get("outbox") or {}

assert release.get("commit_sha") == expected_sha, (release, expected_sha)
assert artifact.get("git_sha") == expected_sha, (artifact, expected_sha)
assert artifact.get("image_digest") == expected_digest, (artifact, expected_digest)
assert int(outbox.get("poisoned") or 0) == 0, outbox
assert int(outbox.get("stale_leases") or 0) == 0, outbox
oldest_age = outbox.get("oldest_pending_age_seconds")
assert oldest_age is None or int(oldest_age) <= 300, outbox

summary = {
    "verified": True,
    "release_sha": expected_sha,
    "image_digest": expected_digest,
    "outbox": {
        "pending": int(outbox.get("pending") or 0),
        "retryable": int(outbox.get("retryable") or 0),
        "poisoned": int(outbox.get("poisoned") or 0),
        "stale_leases": int(outbox.get("stale_leases") or 0),
        "oldest_pending_age_seconds": oldest_age,
    },
}
Path(summary_path).write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
print(json.dumps(summary, sort_keys=True))
PY

echo "post-load reconciliation: PASS"
