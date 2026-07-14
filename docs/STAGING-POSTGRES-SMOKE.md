# Staging Postgres smoke (local)

**Дата:** 2026-07-15  
**Репозиторий:** https://github.com/PetrFedin/renova  
**Зачем:** до merge в `main` доказать, что профиль `staging` живёт на Postgres + Alembic, без SQLite/`create_all`/demo seed.

## Отличие от `staging-env-smoke.sh`

| Скрипт | Что проверяет |
|--------|----------------|
| `scripts/staging-env-smoke.sh` | Policy dry-run (можно без Docker) |
| `scripts/staging-postgres-smoke.sh` | Docker Postgres :5435 → `alembic upgrade head` → temp API :8102 → `health.environment=staging` |

## Запуск

```bash
bash scripts/staging-postgres-smoke.sh
# или
npm run staging:postgres
```

Требования: Docker, `backend/.venv` с `asyncpg` + `alembic`.

## Что делает

1. `docker compose -f docker-compose.staging.yml up -d postgres` (БД `renova_staging`, порт **5435**)
2. `ENVIRONMENT=staging` + Postgres URL → `alembic upgrade head`
3. Проверка: staging + sqlite → fail
4. Временный uvicorn `:8102` с `DOCUMENT_OCR_MODE=async`, без seed
5. `GET /health` → `"environment":"staging"`
6. Регистрация пользователя + `GET /api/v1/ocr/worker` → `mode=async`
7. Останавливает temp API (Postgres контейнер можно оставить)

Cleanup:

```bash
docker compose -f docker-compose.staging.yml down
# volume: docker volume rm renova_renova_pg_staging   # если нужен clean slate
```

## Риски / заметки

- Порт **5435** выбран, чтобы не конфликтовать с local `:5433` из `docker-compose.yml`.
- Битый YAML `volumes`/`services` в старом compose починен: observability → profile `obs`.
- Реальные staging secrets только из vault; здесь ephemeral `SECRET_KEY`.

## Связь

- PR #2: https://github.com/PetrFedin/renova/pull/2
- `docs/STAGING-SMOKE.md`, `docs/MERGE-DEVELOP-TO-MAIN.md`
- OCR async: `docs/DOCUMENT-CENTER-WAVE3C.md`

## Last local run

PASS — see `STAGING-POSTGRES-SMOKE-RESULTS-2026-07-15.md`.
