#!/usr/bin/env bash
# Печатает changelog develop↔main для Release / TestFlight.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
git fetch origin main develop >/dev/null 2>&1 || true
echo "# Renova v0.2.0 — changelog draft"
echo ""
echo "Generated: $(date -u +%Y-%m-%dT%H:%MZ)"
echo "Range: origin/main..origin/develop"
echo ""
COUNT=$(git rev-list --count origin/main..origin/develop 2>/dev/null || echo "?")
echo "Commits ahead of main: $COUNT"
echo ""
echo "## Highlights"
echo "- Document Center waves 2–3f (upload, ACL, legal hold, OCR, e-sign scaffold, mobile picker)"
echo "- Environment guards + staging Postgres smoke"
echo "- Offline queue + plan/fact"
echo ""
echo "## Commits (oneline)"
git log --oneline origin/main..origin/develop 2>/dev/null | head -80
echo ""
echo "## Docs"
echo "- docs/TESTFLIGHT-NOTES-v0.2.md"
echo "- docs/MERGE-DEVELOP-TO-MAIN.md"
echo "- docs/RELEASE-v0.2-PREP.md"
