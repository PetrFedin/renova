# Renova — Environment Profiles (A-06)

**Дата:** 2026-08-23  
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
5. `python -m app.core.runtime_preflight` — проверка deployment/runtime зависимостей до выпуска

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

## «Мой налог»: credential lifecycle

Интеграция по умолчанию выключена. Если `MOY_NALOG_ENABLED=true` в `staging` или `production`, deployment должен задать отдельный keyring для шифрования OAuth-токенов:

```bash
MOY_NALOG_ENABLED=true
MOY_NALOG_CLIENT_ID=<provider client id>
MOY_NALOG_CLIENT_SECRET=<provider client secret>
MOY_NALOG_REDIRECT_URI=https://app.example.com/api/v1/fns/moy-nalog/oauth/callback
MOY_NALOG_TOKEN_URL=https://<provider-token-endpoint>
MOY_NALOG_TOKEN_ENCRYPTION_KEYS=<independent-primary-key>
MOY_NALOG_TOKEN_RECOVERY_RETENTION_DAYS=30
MOY_NALOG_TOKEN_EXPIRING_THRESHOLD_SEC=3600
```

`MOY_NALOG_TOKEN_ENCRYPTION_KEYS` нельзя заменять `SECRET_KEY`: signing key приложения и ключ шифрования provider credentials имеют разные жизненные циклы. Каждый ключ должен быть не короче 32 UTF-8 bytes; значения в списке должны быть уникальными.

Порядок безопасной ротации:

1. Сгенерировать новый независимый ключ (`openssl rand -hex 32`).
2. Развернуть `MOY_NALOG_TOKEN_ENCRYPTION_KEYS=<new>,<previous>`. Новый ключ становится primary, старый остаётся доступен для чтения существующих ciphertext.
3. Проверить `python -m app.core.runtime_preflight` и `/admin/release-health`: интеграция должна быть configured/healthy, primary key id меняется, raw keys не выводятся.
4. Не удалять previous key, пока записи, зашифрованные им, не истекли или пользователи не переподключили интеграцию. При преждевременном удалении запись не стирается, а переходит в безопасное состояние `encryption_key_unavailable`.
5. После окончания переходного окна удалить previous key и снова прогнать preflight/release-health.

Если provider вернул `refresh_token`, Renova может хранить его зашифрованным ограниченное время после истечения access token как recovery credential. Это **не** означает, что автоматический refresh поддерживается или что provider гарантированно примет refresh token: сетевой refresh не включается до подтверждения официального provider contract. Истёкший access token никогда не считается активным.

## Tests

```bash
cd backend && python -m pytest tests/test_environment_guards.py -q
```

Focused credential lifecycle gate:

```bash
cd backend && poetry run pytest -q \
  tests/test_moy_nalog_credential_lifecycle.py \
  tests/test_npd_moy_nalog_truth_integrity.py \
  tests/test_moy_nalog_truth_repair.py
```

## Health

`GET /health` → `{ "status": "ok", "environment": "development", ... }`

`GET /api/v1/fns/health` (authenticated) exposes only the current user's safe OAuth state (`active`, `expiring`, `expired_refresh_token_retained`, `reconnect_required`, etc.) and never raw credentials.

`GET /api/v1/admin/release-health` exposes only operator-safe Moy Nalog configuration/store/keyring metadata; raw OAuth tokens and encryption-key material are never returned.
