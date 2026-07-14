# Staging smoke

**Цель:** убедиться, что профиль `staging`/`production` не поднимется на SQLite + default SECRET, и (опционально) live health отдаёт верный `environment`.

## Dry-run (без деплоя)

```bash
bash scripts/staging-env-smoke.sh
```

Переопределения:

```bash
ENVIRONMENT=staging \
DATABASE_URL=postgresql+asyncpg://u:p@host/db \
PUBLIC_BASE_URL=https://api-staging.example.com \
SECRET_KEY="$(openssl rand -hex 32)" \
bash scripts/staging-env-smoke.sh
```

## Live health

```bash
API_BASE=https://api-staging.example.com bash scripts/staging-env-smoke.sh
# ожидает health.environment ∈ {staging, production}
```

## Чеклист деплоя

1. Скопировать `backend/.env.staging.example` → secrets store (не git)
2. `openssl rand -hex 32` → SECRET_KEY
3. Postgres up; `cd backend && alembic upgrade head`
4. Запуск API; `GET /health` → `"environment":"staging"`
5. `bash scripts/e2e-smoke.sh` с `API=$API_BASE` (если smoke поддерживает; иначе ручной upload+ACL)

## Связь

- Guards: `docs/ENVIRONMENT-PROFILES.md`
- Merge: `docs/MERGE-DEVELOP-TO-MAIN.md`
