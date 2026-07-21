#!/usr/bin/env bash
# Status for split develop→main release (docs/SPLIT-RELEASE-PR-PLAN-2026-07-21.md)
set -euo pipefail
cd "$(dirname "$0")/.."
echo "=== develop HEAD ==="
git fetch origin develop main 2>/dev/null || true
git rev-parse --short origin/develop 2>/dev/null || git rev-parse --short develop
echo "=== commits develop not in main ==="
git rev-list --count origin/main..origin/develop 2>/dev/null || git rev-list --count main..develop
echo "=== suggested slices (manual) ==="
cat <<'EOF'
1. security-acl
2. acceptance-schedule
3. payments
4. offline
5. documents-fns
6. ia-portal
Gate: npm run merge:check:live && npm run h0:check:live (staging URL required)
EOF
