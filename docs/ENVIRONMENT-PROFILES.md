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

`MOY_NALOG_TOKEN_ENCRYPTION_KEYS` нельзя заменять `SECRET_KEY`: signing key приложения и ключ шифрования provider credentials имеют разные жизненные циклы. Каждый новый dedicated key должен быть не короче 32 UTF-8 bytes; значения в списке должны быть уникальными.

### Первый переход с legacy encryption

Старые OAuth records до введения dedicated keyring были зашифрованы ключом, производным от текущего `SECRET_KEY`. Поэтому **нельзя в одном deployment одновременно вводить новый keyring и менять `SECRET_KEY`**: это лишит runtime возможности прочитать legacy ciphertext.

Безопасный порядок перехода:

1. Оставить действующий `SECRET_KEY` без изменений и добавить новый независимый `MOY_NALOG_TOKEN_ENCRYPTION_KEYS=<new-primary>`.
2. Развернуть код и проверить preflight/release-health. При чтении legacy record runtime использует ещё действующий `SECRET_KEY`, валидирует запись и переписывает её в versioned envelope под новым dedicated primary key.
3. Выдержать переходное окно не меньше максимального legacy access-token TTL. В текущем контракте `expires_in` ограничен максимумом 30 дней; legacy Redis records сверх своего access TTL не сохранялись.
4. Только после окончания окна и проверки интеграции ротировать общий `SECRET_KEY`. После этого provider credentials уже не должны зависеть от signing secret.

Этот порядок не требует помещать `SECRET_KEY` в новый dedicated keyring и сохраняет разделение ключевых доменов.

### Последующая ротация dedicated keyring

1. Сгенерировать новый независимый ключ (`openssl rand -hex 32`).
2. Развернуть `MOY_NALOG_TOKEN_ENCRYPTION_KEYS=<new>,<previous>`. Новый ключ становится primary, старый остаётся доступен для чтения существующих ciphertext.
3. Проверить `python -m app.core.runtime_preflight` и `/api/v1/admin/release-health`: интеграция должна быть configured/healthy, primary key id меняется, raw keys не выводятся.
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
