#!/usr/bin/env bash
# P1.11 — создать slice-ветку от origin/main для следующего PR (не merge).
set -euo pipefail
cd "$(dirname "$0")/.."
SLICE="${1:-security-acl}"
git fetch origin develop main 2>/dev/null || true
HEAD="$(git rev-parse --short origin/develop 2>/dev/null || git rev-parse --short develop)"
AHEAD="$(git rev-list --count origin/main..origin/develop 2>/dev/null || echo '?')"
BRANCH="release/${SLICE}"

cat <<EOF
=== Split release next ===
develop HEAD: ${HEAD}
commits ahead of main: ${AHEAD}
slice: ${SLICE}
branch: ${BRANCH}

Порядок (docs/SPLIT-RELEASE-PR-PLAN-2026-07-21.md):
1. security-acl
2. acceptance-schedule
3. payments
4. offline
5. documents-fns
6. ia-portal

Создать ветку от main и cherry-pick диапазон — вручную по файлам slice.
Авто-cherry-pick всего develop опасен (${AHEAD} коммитов).
EOF

if [[ "${2:-}" == "--create-branch" ]]; then
  git checkout -B "$BRANCH" origin/main
  echo "Checked out $BRANCH from origin/main — cherry-pick files for ${SLICE}, then:"
  echo "  gh pr create --base main --head $BRANCH --title "release: ${SLICE}" ..."
fi

bash scripts/split-release-status.sh
