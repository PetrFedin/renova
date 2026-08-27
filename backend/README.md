# Renova Backend

The backend uses the repository lock contract. Do not create an ad-hoc virtualenv or manually install application packages outside Poetry.

## Canonical full local runtime

From the repository root:

```bash
npm run dev -- doctor
npm run dev -- bootstrap
npm run dev
npm run dev -- check
```

This is the preferred path because it proves the intended local topology:

`PostgreSQL + Redis + MinIO + renova-api + renova-worker`.

`env.local.example` / `.env.local` are development-only. Staging/production examples and credentials must not be used as a local fallback.

## Backend-only debugging

Use backend-only startup only when debugging the API process intentionally; it is not a substitute for the full local runtime.

Prerequisites are still the exact repository toolchain: Python 3.12.13, Poetry 2.4.1 and `poetry.lock`.

```bash
# from repository root
npm run dev -- bootstrap
npm run dev -- infra

set -a
source .env.local
set +a

cd backend
poetry check --lock
poetry run python -m pip check
poetry run alembic upgrade head
poetry run python -m app.core.runtime_preflight
poetry run uvicorn app.main:app --reload --port 8100
```

API docs: http://127.0.0.1:8100/docs

For the dedicated worker and heartbeat checks use the full root runtime instead of starting background jobs inside the API process.

## Бюджет и факт

- Server ledger: `app/services/budget_service.py` (`refresh_budget_facts`, `budget_summary`)
- Контракт с mobile UI: `../docs/BUDGET_FACT.md`
