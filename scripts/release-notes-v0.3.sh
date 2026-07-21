#!/usr/bin/env bash
# Changelog develop↔main для Release v0.3 (P3-W12–W14).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
git fetch origin main develop >/dev/null 2>&1 || true
echo "# Renova v0.3.0 — changelog draft"
echo ""
echo "Generated: $(date -u +%Y-%m-%dT%H:%MZ)"
echo "Range: origin/main..origin/develop"
echo ""
COUNT=$(git rev-list --count origin/main..origin/develop 2>/dev/null || echo "?")
echo "Commits ahead of main: $COUNT"
echo ""
echo "## Highlights"
echo "- Project lifecycle: archive/trash, scroll picker, access_mode, guest guard"
echo "- Reports promoted to More menu; project-analytics redirect"
echo "- Portal/documents E2E (API + browser UI smoke)"
echo "- Kontur staging guard + docs/STAGING-KONTUR.md"
echo ""
echo "## Commits (oneline)"
git log --oneline origin/main..origin/develop 2>/dev/null | head -80
echo ""
echo "## Pre-merge"
echo "- npm run merge:check"
echo "- docs/STAGING-KONTUR.md"
