# CI fix: Alembic missing from Poetry env (2026-07-15)

**Репозиторий:** https://github.com/PetrFedin/renova  
**Ветка:** `develop`  
**После:** NotificationType fix `da674dc`

## Симптом

Job `e2e` → step **Alembic on Postgres service (smoke)**:

```text
Command not found: alembic
```

при `poetry run alembic upgrade head`.

Шаг SQLite **e2e-smoke** уже зелёный после uvicorn + NotificationType.

## Корневая причина

`alembic` не был объявлен в `backend/pyproject.toml` как dependency. Локальный `.venv` мог содержать пакет от ручного install → `staging:postgres` PASS; fresh CI Poetry env — нет console script.

## Исправление

1. `backend/pyproject.toml` — `alembic = "^1.14.0"`
2. CI install step: `poetry run pip install fpdf2 alembic` (как уже было для `fpdf2`, пока lock не обязателен)
3. CI alembic step: `poetry run python -m alembic upgrade head`

## Проверка на GitHub Actions

Зелёный job `e2e` на push/PR #2 (оба шага).

## Дальше (не блокер merge)

- `poetry lock` / `poetry add alembic` когда PyPI доступен, чтобы lock совпадал с pyproject без pip sidecar.
