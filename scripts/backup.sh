#!/usr/bin/env bash
set -euo pipefail
PG="${DATABASE_URL:-postgresql://renova:renova@localhost:5433/renova}"
pg_dump "${PG#*://}" 2>/dev/null || sqlite3 backend/renova.db ".backup backup.db"
echo "backup ok"
