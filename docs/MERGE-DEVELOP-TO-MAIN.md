# Merge `develop` → `main` — детальный пакет готовности

**Дата:** 2026-07-15  
**Репозиторий:** https://github.com/PetrFedin/renova  
**Стратегия:** осознанный PR, **без auto-merge**  
**Отставание:** ~101 коммитов `origin/main..origin/develop` (пересчитать перед merge)

## Зачем сейчас

P0 Document Center + env guards + offline + e2e закрыты на `develop`.  
`main` нужен как стабильная линия для TestFlight / staging деплоя, но прямой push без PR запрещён checklist’ом.

## Критерии (автоматика)

| # | Критерий | Как проверить | Статус |
|---|----------|---------------|--------|
| 1 | Offline / routes / guards / docs tests | `npm run test:priority` | automated |
| 2 | Live e2e Document Center + wave3/3b | `bash scripts/e2e-smoke.sh` (API :8100) | automated if API up |
| 3 | Env guards reject default SECRET | `bash scripts/staging-env-smoke.sh` + proof в `merge-readiness` | automated |
| 4 | Нет weak SECRET вне templates | scan в `scripts/merge-readiness.sh` | automated |
| 5 | Человек подтвердил risk list в PR | этот документ + PR body | manual |
| 6 | Staging Postgres + `alembic upgrade head` | ops перед деплоем | manual |

Единый gate:

```bash
bash scripts/merge-readiness.sh
```

## SECRET_KEY / defaults — аудит

### Где default допустим
- `backend/app/core/config.py` → `dev-secret-change-me` **только** для `ENVIRONMENT=development|test`
- `backend/.env.example`, корневой `.env.example` — документация local

### Где default запрещён (startup fail)
- `ENVIRONMENT=staging|production` + default/short SECRET → `ValueError` в `validate_runtime_settings`
- SQLite Forbidden, localhost PUBLIC_BASE_URL Forbidden (staging/prod)
- production additionally: PUBLIC_BASE_URL must be `https://`

### Доказательство
- `backend/tests/test_environment_guards.py`
- templates: `backend/.env.staging.example`, `backend/.env.production.example` (пустой SECRET_KEY)

**Вывод для checklist:** пункт «Нет SECRET_KEY/default в staging/prod конфигах» = **закрыт** (guards + empty staging/prod templates + scan). Реальные секреты только в vault/CI, не в git.

## Риски merge (обязательны в PR)

1. **Объём:** 100+ коммитов — высокий blast radius (auth, finance, documents, media ACL).
2. **Миграции:** нужны `m3n4…` documents + `n4o5…` legal_hold + `o5p6…` OCR/esign; staging/prod только Alembic.
3. **Media ACL breaking change:** `documents/*` media без membership → 404 (раньше soft / anon leak).
4. **Multipart dependency:** API не стартует без `python-multipart` (см. инцидент + `start-dev.sh`).
5. **E-sign kontur/goskey:** сознательно **501** — клиенты не должны ждать внешнюю УКЭП.
6. **OCR stub:** эвристики могут сменить `upload` → `contract` и т.п.; не ML.
7. **SQLite local vs Postgres staging:** schema drift через `sqlite_compat` — на staging обязателен Alembic path.

## Что НЕ входит в этот release

- Реальный OCR engine / worker queue
- Kontur / Госключ SDK
- Auto-tag без ручного решения (`v0.2.0` после merge)

## Команды (человек после approve)

```bash
# После green checks + review
gh pr merge <N> --merge --subject "release: merge develop (documents wave2-3b, guards, offline)"
git checkout main && git pull
git tag -a v0.2.0 -m "Renova 0.2.0 — Document Center + env guards"
git push origin v0.2.0
```

См. также `TESTFLIGHT-NOTES-v0.2.md`, `STAGING-SMOKE.md`, `MAIN-MERGE-CHECKLIST.md`.
