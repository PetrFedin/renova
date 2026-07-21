#!/usr/bin/env bash
# P1.10: push .github/workflows/* requires GitHub token scope `workflow`.
# Cursor OAuth (gho_) usually lacks it — use PAT or refresh gh scopes.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "Checking gh scopes…"
scopes="$(gh api -i user 2>/dev/null | tr -d '\r' | awk -F': ' 'tolower($1)=="x-oauth-scopes"{print $2}')"
echo "scopes: ${scopes:-unknown}"
if [[ "${scopes}" != *workflow* ]]; then
  cat <<'EOF'
❌ Нет scope workflow.

Сделайте один раз (откроется браузер):
  gh auth refresh -h github.com -s workflow,repo,read:org,gist

Или создайте PAT (classic) с repo + workflow и:
  GH_TOKEN=ghp_xxx git push origin develop

Затем:
  git add .github/workflows/ci.yml
  git commit -m "ci: fail closed on e2e:web"
  git push origin HEAD
EOF
  exit 1
fi

git add .github/workflows/ci.yml
if git diff --cached --quiet; then
  echo "ci.yml already staged/committed or unchanged vs index"
else
  git commit -m "ci: fail closed on e2e:web (P1.10)"
fi
git push -u origin HEAD
echo "✅ CI workflow pushed"
