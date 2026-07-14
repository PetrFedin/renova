# Staging Postgres smoke — results 2026-07-15

**Команда:** `bash scripts/staging-postgres-smoke.sh` / `npm run staging:postgres`  
**Результат:** **PASS** (`EXIT:0`)  
**Ветка:** `develop`

## Доказано

1. Docker Postgres `renova_staging` на **:5435**
2. `alembic upgrade head` на **чистой** БД (после фиксов gap-таблиц)
3. `ENVIRONMENT=staging` + sqlite → reject
4. Temp API `:8102` → `health.environment=staging`
5. `DOCUMENT_OCR_MODE=async` → `GET /api/v1/ocr/worker` mode=async
6. Demo seed skipped (staging policy)

## Alembic gaps закрыты в этом срезе

Исторически часть таблиц жила только через SQLite `create_all`. На clean Postgres падали миграции:

| Revision | Gap | Fix |
|----------|-----|-----|
| `g7h8…` | `material_picks` | create-if-missing before FK |
| `i9j0…` | `chat_thread_reads` | create-if-missing + idempotent columns |
| `m3n4…` | `work_acceptances` | `_ensure_work_acceptances()` |

Плюс: починен битый `docker-compose.yml` (services уезжали в `volumes`).

## Связь

- `docs/STAGING-POSTGRES-SMOKE.md`
- `docs/DOCUMENT-CENTER-WAVE3C.md`
- PR #2 остаётся открытым для human merge
