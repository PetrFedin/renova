#!/usr/bin/env bash
# Commit + push .github/workflows/ci.yml (requires gh OAuth scope: workflow).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! gh auth status 2>&1 | grep -q "'workflow'"; then
  echo "ERROR: gh token missing scope 'workflow'."
  echo "Run: gh auth refresh -h github.com -s workflow"
  echo "Then: bash scripts/push-ci-workflow.sh"
  exit 1
fi

if ! git diff --quiet .github/workflows/ci.yml; then
  git add .github/workflows/ci.yml
  git commit -m "ci: test-priority + ci-playwright jobs (P3-W20 workflow)"
fi

git push origin develop
echo "push-ci-workflow: OK"
