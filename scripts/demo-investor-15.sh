#!/usr/bin/env bash
# Investor 15-min walkthrough checklist.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "=== Renova — demo investor 15 min ==="
echo "Pre: npm run h0:check  (prefer API_BASE=https://... npm run h0:check:live)"
echo ""
echo "0-2 min   Problem: Excel/WhatsApp/bank -> Renova Home"
echo "2-5 min   Estimate template -> lock (customer agrees)"
echo "5-8 min   Stage acceptance (one orchestrator)"
echo "8-11 min  Budget invoice -> live pay OR honest requisites"
echo "11-13 min Documents act / digest preview"
echo "13-15 min Portal magic link + Team QR + H0 chip READY"
echo ""
echo "Do NOT show: localhost API, demo Pro bypass, WA Business sync"
echo ""

if [[ -n "${API_BASE:-}" ]]; then
  echo "Live API: $API_BASE"
  bash scripts/h0-check.sh --live || true
fi
