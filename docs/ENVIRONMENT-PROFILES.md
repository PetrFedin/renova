# Renova — Environment Profiles (A-06)

**Дата:** 2026-07-15  
**Код:** `backend/app/core/environment.py`, `backend/app/core/config.py`, `backend/app/db/session.py`, `backend/app/main.py`

## Profiles

| ENVIRONMENT | SQLite | create_all | demo seed | PUBLIC_BASE_URL | SECRET_KEY |
|-------------|--------|------------|-----------|-----------------|------------|
| development | ✅ | ✅ | ✅ | localhost OK | soft warn |
| test | ✅ | ✅ | ✅ | any | soft |
| staging | ❌ Postgres | ❌ Alembic only | ❌ | обязателен, не localhost | обязателен ≠ default |
| production | ❌ Postgres | ❌ Alembic only | ❌ | https обязателен | сильный ключ |

## Startup sequence

1. `validate_runtime_settings(...)` — hard fail при нарушении
2. Soft warnings в лог (dev)
3. `init_db()` — `create_all` только если policy.allow_create_all
4. `ensure_demo_users` / `seed_articles` только если policy.allow_demo_seed

## Local

```bash
ENVIRONMENT=development
DATABASE_URL=sqlite+aiosqlite:///./renova.db
PUBLIC_BASE_URL=http://127.0.0.1:8100
SECRET_KEY=dev-secret-change-me
```

## Staging (пример)

```bash
ENVIRONMENT=staging
DATABASE_URL=postgresql+asyncpg://renova:…@db:5432/renova
PUBLIC_BASE_URL=https://api-staging.renova.app
SECRET_KEY=<openssl rand -hex 32>
# alembic upgrade head  (до старта uvicorn)
```

## Production

Как staging + `PUBLIC_BASE_URL` строго `https://…`.

## Tests

```bash
cd backend && python -m pytest tests/test_environment_guards.py -q
```

## Health

`GET /health` → `{ "status": "ok", "environment": "development", ... }`

## Capability / bypass guards

- `MY_NALOG_DEV_BYPASS_ENABLED` — только development/test. В staging/production `validate_runtime_settings` hard-fail при `true`; runtime guard всё равно возвращает Forbidden.
- OCR: `DOCUMENT_OCR_ENABLED`, `DOCUMENT_OCR_PROVIDER` (`heuristic`→local, `demo`→demo). См. `SERVICE-CAPABILITIES.md`.


## Sentry (production)

- `SENTRY_DSN` required in **production**, or explicit `SENTRY_APPROVED_WITHOUT_DSN=true`.
- Mobile: `EXPO_PUBLIC_SENTRY_DSN` or `EXPO_PUBLIC_SENTRY_APPROVED_WITHOUT_DSN=true`.
- Events pass through `before_send` / `sanitizeSentryEvent` (no tokens, auth headers, document/message bodies).

## Capability validation

See `validate_capability_settings` in `backend/app/core/environment.py` and `apps/mobile/lib/envSchema.ts`.
Provider-specific vars are required only when the capability is enabled / partially configured.
