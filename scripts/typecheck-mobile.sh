#!/usr/bin/env bash
# Mobile TypeScript integrity with an explicit, ratcheted exception for known
# RN x React 19 JSX noise (TS2786/TS2607). All parsing is portable Node.js and
# any compiler/tooling failure without TypeScript diagnostics fails closed.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/apps/mobile"

STRICT=0
for arg in "$@"; do
  case "$arg" in
    --strict) STRICT=1 ;;
    *) echo "FAIL: unsupported argument: $arg"; exit 2 ;;
  esac
done

# Ratchet down as real errors are fixed. Do not increase casually. Exact branch
# target on 2026-08-08: 10 non-TS2786/non-TS2607 diagnostics.
BASELINE_REAL="${TYPECHECK_BASELINE_REAL:-10}"
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

set +e
npx tsc --noEmit -p . >"$TMP" 2>&1
TSC_EXIT=$?
set -e

ARGS=(
  "--input=$TMP"
  "--tsc-exit=$TSC_EXIT"
  "--baseline=$BASELINE_REAL"
)
if [[ "$STRICT" -eq 1 ]]; then
  ARGS+=(--strict)
fi

node "$ROOT/scripts/typecheck-mobile-report.mjs" "${ARGS[@]}"
