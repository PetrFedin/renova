#!/usr/bin/env bash
# Local mirror of required CI quality gates (no production credentials).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "== secret-scan =="
bash scripts/secret-scan.sh

echo "== npm ci (lockfile) =="
npm ci

echo "== EAS profile validation =="
npm run testflight:eas

echo "== mobile env + sentry unit =="
npx tsx apps/mobile/lib/envSchema.w150.test.ts
npx tsx apps/mobile/lib/sentrySanitize.w150.test.ts
npx tsx apps/mobile/lib/oauthScaffold.w145.test.ts

echo "== mobile typecheck (informational; non-fatal in verify:ci) =="
bash scripts/typecheck-mobile.sh || echo "notice: typecheck reported issues (informational)"

echo "== backend env/sentry/guards =="
cd backend
if [[ -x .venv/bin/python ]]; then
  PY=.venv/bin/python
else
  PY=python3
fi
$PY -m pytest tests/test_environment_guards.py tests/test_env_schema.py tests/test_sentry_sanitize.py -q
echo "== alembic heads (single head) =="
HEADS="$($PY -m alembic heads 2>/dev/null | wc -l | tr -d ' ')"
if [[ "$HEADS" != "1" ]]; then
  echo "FAIL: expected 1 alembic head, got $HEADS"
  $PY -m alembic heads || true
  exit 1
fi
echo "alembic heads OK ($HEADS)"
cd "$ROOT"

echo "== workflow YAML =="
if command -v ruby >/dev/null 2>&1; then
  ruby -ryaml -e 'Dir[".github/workflows/*.yml"].each { |f| YAML.load_stream(File.read(f)); puts "YAML OK #{f}" }'
else
  echo "notice: ruby not available — YAML structural parse skipped"
fi

echo "verify:ci PASS"
