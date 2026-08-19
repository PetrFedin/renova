#!/usr/bin/env bash
set -euo pipefail

API_BASE="${API_BASE:-}"
TOKEN="${TOKEN:-}"
EXPECTED_RELEASE_SHA="${EXPECTED_RELEASE_SHA:-}"
EXPECTED_IMAGE_DIGEST="${EXPECTED_IMAGE_DIGEST:-}"
EXPECTED_ENVIRONMENT="${EXPECTED_ENVIRONMENT:-staging}"
OUT_DIR="${OUT_DIR:-/tmp/renova-external-staging}"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

[[ -n "$API_BASE" ]] || fail "API_BASE is required"
[[ -n "$TOKEN" ]] || fail "TOKEN is required; demo/header identity is forbidden"
[[ "$EXPECTED_RELEASE_SHA" =~ ^[0-9a-f]{40}$ ]] || fail "EXPECTED_RELEASE_SHA must be a 40-character lowercase Git SHA"
[[ "$EXPECTED_IMAGE_DIGEST" =~ ^sha256:[0-9a-f]{64}$ ]] || fail "EXPECTED_IMAGE_DIGEST must be an immutable sha256 digest"
[[ "$EXPECTED_ENVIRONMENT" == "staging" ]] || fail "external staging verification only accepts EXPECTED_ENVIRONMENT=staging"

case "$API_BASE" in
  https://*) ;;
  *) fail "API_BASE must use https://" ;;
esac
case "$API_BASE" in
  *example.com*|*localhost*|*127.0.0.1*) fail "API_BASE is placeholder/local: $API_BASE" ;;
esac
API_BASE="${API_BASE%/}"
mkdir -p "$OUT_DIR"

health_file="$OUT_DIR/health.json"
ready_file="$OUT_DIR/ready.json"
h0_file="$OUT_DIR/h0.json"
release_file="$OUT_DIR/release-health.json"
summary_file="$OUT_DIR/verified-release.json"

curl_json() {
  local url="$1"
  local target="$2"
  shift 2
  curl --fail-with-body --silent --show-error \
    --retry 3 --retry-delay 1 --connect-timeout 5 --max-time 20 \
    "$url" "$@" >"$target"
  python3 -m json.tool "$target" >/dev/null || fail "non-JSON response from $url"
}

curl_json "$API_BASE/health" "$health_file"
curl_json "$API_BASE/ready" "$ready_file"
curl_json "$API_BASE/api/v1/admin/h0-readiness" "$h0_file" -H "Authorization: Bearer $TOKEN"
curl_json "$API_BASE/api/v1/admin/release-health" "$release_file" -H "Authorization: Bearer $TOKEN"

python3 - \
  "$health_file" \
  "$ready_file" \
  "$h0_file" \
  "$release_file" \
  "$summary_file" \
  "$EXPECTED_RELEASE_SHA" \
  "$EXPECTED_IMAGE_DIGEST" \
  "$EXPECTED_ENVIRONMENT" <<'PY'
import json
import sys
from pathlib import Path

health_path, ready_path, h0_path, release_path, summary_path, expected_sha, expected_digest, expected_env = sys.argv[1:]


def load(path):
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


health = load(health_path)
ready = load(ready_path)
h0 = load(h0_path)
release = load(release_path)

assert health.get("status") == "ok", health
assert health.get("environment") == expected_env, health
assert health.get("release") == expected_sha, health
assert health.get("artifact_digest") == expected_digest, health

assert ready.get("status") == "ready", ready
assert ready.get("release") == expected_sha, ready
assert ready.get("artifact_digest") == expected_digest, ready

assert h0.get("environment") == expected_env, h0
checks = {item.get("id"): item for item in h0.get("checks", [])}
assert checks.get("auth_bearer", {}).get("ok") is True, h0
assert isinstance(h0.get("blockers"), list), h0

assert release.get("environment") == expected_env, release
assert isinstance(release.get("integrations"), dict), release
assert isinstance(release["integrations"].get("outbox"), dict), release

summary = {
    "verified": True,
    "environment": expected_env,
    "release_sha": expected_sha,
    "image_digest": expected_digest,
    "health": health.get("status"),
    "readiness": ready.get("status"),
    "h0_score": h0.get("score"),
    "h0_blockers": len(h0.get("blockers", [])),
}
Path(summary_path).write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
print(json.dumps(summary, sort_keys=True))
PY

echo "external staging release smoke: PASS sha=$EXPECTED_RELEASE_SHA digest=$EXPECTED_IMAGE_DIGEST"
