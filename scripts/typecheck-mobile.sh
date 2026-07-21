#!/usr/bin/env bash
# W70 #38: typecheck mobile — ignore RN×React19 JSX noise (TS2786/TS2607).
# Default: soft report. --strict fails if real errors exceed baseline.
# Baseline ratchets down as real errors are fixed (do not raise casually).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/apps/mobile"

STRICT=0
for arg in "$@"; do
  [[ "$arg" == "--strict" ]] && STRICT=1
done

# After W70 ProfileFields VAT fix; ratchet down when cleaning more files.
BASELINE_REAL="${TYPECHECK_BASELINE_REAL:-117}"

TMP="$(mktemp)"
FILTERED="$(mktemp)"
trap 'rm -f "$TMP" "$FILTERED"' EXIT

npx tsc --noEmit -p . >"$TMP" 2>&1 || true
rg -v "error TS2786:|error TS2607:" "$TMP" >"$FILTERED" || true

REAL="$(rg -c "error TS" "$FILTERED" || true)"
NOISE_2786="$(rg -c "error TS2786:" "$TMP" || true)"
NOISE_2607="$(rg -c "error TS2607:" "$TMP" || true)"
REAL="${REAL:-0}"
NOISE_2786="${NOISE_2786:-0}"
NOISE_2607="${NOISE_2607:-0}"

echo "typecheck-mobile: TS2786=${NOISE_2786} TS2607=${NOISE_2607} real=${REAL} baseline=${BASELINE_REAL}"

if [[ "$REAL" -gt 0 ]]; then
  echo "--- real errors (first 20) ---"
  rg "error TS" "$FILTERED" | head -20 || true
fi

if [[ "$REAL" -gt "$BASELINE_REAL" ]]; then
  echo "FAIL: real errors ${REAL} > baseline ${BASELINE_REAL}"
  exit 1
fi

if [[ "$STRICT" -eq 1 && "$REAL" -gt 0 ]]; then
  echo "FAIL: --strict and ${REAL} real errors remain"
  exit 1
fi

if [[ "$REAL" -gt 0 ]]; then
  echo "WARN: ${REAL} real errors (≤ baseline); use --strict for zero-tolerance"
else
  echo "PASS: no real TypeScript errors (JSX noise gated)"
fi
