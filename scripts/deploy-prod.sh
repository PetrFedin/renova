#!/usr/bin/env bash
set -euo pipefail
export DATABASE_URL="${DATABASE_URL:-postgresql+asyncpg://renova:renova@localhost:5433/renova}"
cd "$(dirname "$0")/../backend" && source .venv/bin/activate
alembic upgrade head
uvicorn app.main:app --host 0.0.0.0 --port 8100
