#!/usr/bin/env bash
# Generate a source-backed staging readiness report from live protected endpoints.
# Requires an explicit contractor Bearer token. Never creates demo users and never
# falls back to X-User-Id.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
API_BASE="${API_BASE:-}"
TOKEN="${TOKEN:-}"
REQUIRE_INVESTOR_READY="${REQUIRE_INVESTOR_READY:-0}"
LOCAL_SHA="$(git -C "$ROOT" rev-parse HEAD)"
SHORT="$(git -C "$ROOT" rev-parse --short HEAD)"
OUT="${REPORT_OUT:-$ROOT/docs/STAGING-READINESS-REPORT-${SHORT}.md}"
TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
HEALTH_FILE="$(mktemp)"
H0_FILE="$(mktemp)"
RELEASE_FILE="$(mktemp)"

cleanup() {
  rm -f "$HEALTH_FILE" "$H0_FILE" "$RELEASE_FILE"
}
trap cleanup EXIT

if [ -z "$API_BASE" ]; then
  echo "FAIL: API_BASE=https://... is required" >&2
  exit 1
fi
if [ -z "$TOKEN" ]; then
  echo "FAIL: TOKEN is required; demo and X-User-Id fallbacks are forbidden" >&2
  exit 1
fi
case "$API_BASE" in
  https://*) ;;
  *)
    echo "FAIL: API_BASE must use https://" >&2
    exit 1
    ;;
esac
API_BASE="${API_BASE%/}"

curl --fail-with-body --silent --show-error --retry 3 --retry-delay 1 \
  "$API_BASE/health" >"$HEALTH_FILE"
curl --fail-with-body --silent --show-error --retry 3 --retry-delay 1 \
  "$API_BASE/api/v1/admin/h0-readiness" \
  -H "Authorization: Bearer $TOKEN" >"$H0_FILE"
curl --fail-with-body --silent --show-error --retry 3 --retry-delay 1 \
  "$API_BASE/api/v1/admin/release-health" \
  -H "Authorization: Bearer $TOKEN" >"$RELEASE_FILE"

python3 - "$HEALTH_FILE" "$H0_FILE" "$RELEASE_FILE" "$REQUIRE_INVESTOR_READY" <<'PY'
import json
import sys

health = json.load(open(sys.argv[1], encoding="utf-8"))
h0 = json.load(open(sys.argv[2], encoding="utf-8"))
release = json.load(open(sys.argv[3], encoding="utf-8"))
assert health.get("status") == "ok", health
assert health.get("environment") in {"staging", "production"}, health
assert h0.get("environment") == health.get("environment"), (health, h0)
checks = {item.get("id"): item for item in h0.get("checks", [])}
assert checks.get("auth_bearer", {}).get("ok") is True, h0
assert isinstance(h0.get("blockers"), list), h0
assert release.get("environment") == health.get("environment"), release
assert isinstance(release.get("integrations"), dict), release
if sys.argv[4] == "1":
    assert h0.get("ready_for_investor_demo") is True, h0
PY

mkdir -p "$(dirname "$OUT")"
python3 - \
  "$HEALTH_FILE" "$H0_FILE" "$RELEASE_FILE" \
  "$OUT" "$TS" "$LOCAL_SHA" "$API_BASE" <<'PY'
import json
import pathlib
import sys

health = json.load(open(sys.argv[1], encoding="utf-8"))
h0 = json.load(open(sys.argv[2], encoding="utf-8"))
release = json.load(open(sys.argv[3], encoding="utf-8"))
out = pathlib.Path(sys.argv[4])
checked_at = sys.argv[5]
local_sha = sys.argv[6]
api_base = sys.argv[7]
remote_sha = h0.get("git_sha") or "unknown"
blockers = h0.get("blockers") or []

lines = [
    "# Staging Readiness Report",
    "",
    f"- checked_at: `{checked_at}`",
    f"- api_base: `{api_base}`",
    f"- environment: `{health.get('environment')}`",
    f"- local_git_sha: `{local_sha}`",
    f"- remote_git_sha: `{remote_sha}`",
    f"- ready_for_investor_demo: `{str(bool(h0.get('ready_for_investor_demo'))).lower()}`",
    f"- score: `{h0.get('score')}`",
    f"- blockers: `{len(blockers)}`",
    "- auth: `Authorization: Bearer`",
    "",
    "## Blockers",
    "",
]
if blockers:
    for blocker in blockers:
        lines.append(
            f"- **{blocker.get('label', blocker.get('id', 'unknown'))}** — "
            f"{blocker.get('how', '')}"
        )
else:
    lines.append("- None")

for title, payload in (
    ("Health", health),
    ("H0 readiness", h0),
    ("Release health", release),
):
    lines.extend(
        [
            "",
            f"## {title}",
            "",
            "```json",
            json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True),
            "```",
        ]
    )

out.write_text("\n".join(lines) + "\n", encoding="utf-8")
print(f"Wrote {out}")
PY

echo "staging-readiness-report: PASS"
