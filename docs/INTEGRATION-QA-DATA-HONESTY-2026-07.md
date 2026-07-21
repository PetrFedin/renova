# Integration QA — data honesty release (2026-07)

**Branch:** `integration/data-honesty-release`  
**Final SHA:** `abe5e2bd840c53318253c55218cfe48f7df4e67d` (code tip `9693fc39` + this report)  
**Base main SHA:** `09b16cb234fb555176c3eac8916f91ad1d5b28f1`  
**Date:** 2026-07-21  
**Auto-merge:** **не выполнялся** (ни PR №24–28, ни integration → main).

---

## 1. Исходные SHA (на момент интеграции)

| PR | Branch | Head SHA | Base | Draft | Mergeable |
|----|--------|----------|------|-------|-----------|
| #24 | `agent/data-honesty-stability` | `d724114b62257b881033df7350e4518bdae40164` | main | yes | MERGEABLE |
| #25 | `agent/capability-truth-guards` | `ff8c43359652aa452f0a8b520a2d633313efb6fb` | main | yes | MERGEABLE |
| #26 | `agent/warranty-fail-closed` | `5f39bf2d9b9f736c4fe7fcdf6b8b3e6c83323bcd` | main | yes | MERGEABLE |
| #27 | `agent/portal-payment-evidence` | `21e292ba51c9b65838978640d4b80662e6369141` | main | yes | MERGEABLE |
| #28 | `agent/release-ops-hardening` | `7db79e14d3035b16cf91ec8f6e279f071bc5207d` | main | yes | MERGEABLE |

Проверка «не были ли PR уже обновлены»: все пять всё ещё Draft, base=`main`, head совпадает с `origin/<branch>` на момент сборки.

---

## 2. Порядок применения на integration

1. `origin/main` @ `09b16cb2`
2. PR #24 — fast-forward → `d724114b`
3. PR #25 — merge commit `d84f50b1`
4. PR #26 — merge + ручное разрешение конфликтов → `d91a25bd`
5. **Fix Alembic:** в миграции PR #27 выставить `down_revision = "w5warranty01"`
6. PR #27 — merge с уже исправленным parent → `00373603`
7. PR #28 — merge + union env/docs → `9693fc39`

### Конфликты при интеграции

| Шаг | Файлы | Решение |
|-----|-------|---------|
| #26 | `package.json`, `failClosed.w144.test.ts`, `MAIN-MERGE-CHECKLIST.md` | Union скриптов/assert’ов (OCR+warranty) |
| #27 | `package.json` | Union + `test:payment-evidence` + guards включают `test_payment_evidence.py` |
| #28 | `backend/.env.example`, `docs/ENVIRONMENT-PROFILES.md` | Union capability + Sentry production notes |

### Пересекающиеся файлы (hotspots)

- Все PR: `package.json`
- #25∩#26: `DocumentsHub.tsx`, `MAIN-MERGE-CHECKLIST.md`
- #24∩#26: `failClosed.w144.test.ts`
- #26∩#27: `backend/app/models/entities.py`
- #25∩#28: `.env.example`, `backend/.env.example`, `config.py`, `environment.py`, `main.py`, `ENVIRONMENT-PROFILES.md`

### Env / scripts

- Env: OCR/My Nalog capability vars (#25) + Sentry production guards (#28) объединены в `.env.example` / `backend/.env.example`.
- Scripts: `test:docs-meta` (capabilities), `test:warranty`, `test:payment-evidence`, расширенный `test:guards`, `verify:ci`, `secret:scan`.

---

## 3. Migration graph (линейный)

```
… → w4jtipurge01 → w5warranty01 (PR#26) → w6payev01 (PR#27, fixed parent)  [HEAD]
```

| Revision | Source | down_revision |
|----------|--------|---------------|
| `w5warranty01` | PR #26 | `w4jtipurge01` |
| `w6payev01` | PR #27 **на integration** | **`w5warranty01`** (было `w4jtipurge01` на ветке PR — dual head) |

**Критерий:** `cd backend && PYTHONPATH=. .venv/bin/alembic heads` → ровно одна строка: `w6payev01 (head)`.

**Важно:** PR #27 **нельзя** мержить в `main` до того, как на самой ветке `agent/portal-payment-evidence` (или cherry-pick fix) `down_revision` станет `w5warranty01`. На integration это уже исправлено; исходный PR #27 на GitHub всё ещё содержит старый parent.

Merge migration **не** создавалась.

---

## 4. Alembic runtime (Postgres clean DB)

Воспроизведение:

```bash
docker run -d --name renova-alembic-qa \
  -e POSTGRES_USER=renova -e POSTGRES_PASSWORD=renova -e POSTGRES_DB=renova \
  -p 5439:5432 postgres:17-alpine
# wait pg_isready
cd backend
export DATABASE_URL='postgresql+asyncpg://renova:renova@127.0.0.1:5439/renova'
PYTHONPATH=. .venv/bin/alembic heads          # → w6payev01 (1 head)
PYTHONPATH=. .venv/bin/alembic upgrade head   # clean base→head PASS
PYTHONPATH=. .venv/bin/alembic downgrade -1   # w6→w5 PASS
PYTHONPATH=. .venv/bin/alembic upgrade head   # w5→w6 PASS
```

### DB schema checks (после final upgrade)

| Check | Result |
|-------|--------|
| `warranty_claim_idempotency` exists | PASS |
| Unique `(user_id, project_id, idempotency_key)` | PASS (`uq_warranty_claim_idempotency_scope`) |
| FK → `projects` | PASS |
| Indexes on user/project/issue/document | PASS |
| `payment_evidence` exists | PASS |
| Unique `(payment_id, idempotency_key)` | PASS |
| FK → `payments`, `projects`, `users` | PASS |
| `payments.lock_version` default `0` NOT NULL | PASS |
| Defaults: `version=1`, `row_status='active'`, `antivirus_scanned=false` | PASS |
| Downgrade drops evidence / leaves warranty | PASS |
| Re-upgrade restores evidence | PASS |

**SQLite note:** clean `alembic upgrade head` на пустом SQLite падает на исторических миграциях (`ALTER … FK` / `DROP TYPE`) — ожидаемо. CI/staging используют **Postgres** (см. `.github/workflows/ci.yml`).

---

## 5. Результаты автоматических проверок

| Suite | Command | Result |
|-------|---------|--------|
| Alembic heads | `alembic heads` | **PASS** (1) |
| Migration chain unit | `pytest tests/test_payment_migration_chain.py` | **PASS** |
| Warranty idempotency | `pytest tests/test_warranty_idempotency.py` | **PASS** |
| Payment evidence | `pytest tests/test_payment_evidence.py` | **PASS** |
| OCR capability | `pytest tests/test_ocr_capability.py` | **PASS** |
| My Nalog bypass | `pytest tests/test_moy_nalog_bypass.py` | **PASS** |
| Sentry + env schema | `pytest tests/test_sentry_sanitize.py tests/test_env_schema.py` | **PASS** |
| `test:guards` | `npm run test:guards` | **PASS** |
| Async resource | `npx tsx apps/mobile/lib/asyncResource/asyncResource.test.ts` | **PASS** |
| Fail-closed W144 | `npx tsx apps/mobile/lib/failClosed.w144.test.ts` | **PASS** |
| Warranty mobile | `npm run test:warranty` | **PASS** |
| Payment evidence mobile | `npm run test:payment-evidence` | **PASS** |
| Docs meta + capabilities | `npm run test:docs-meta` | **PASS** |
| Secret scan | `npm run secret:scan` | **PASS** |
| `verify:ci` | `npm run verify:ci` | **PASS** |
| Mobile typecheck | `npm run typecheck:mobile` | **FAIL** (~20 `error TS`, informational в `verify:ci`) |
| Lint | soft / no dedicated gate | soft |
| API E2E / Playwright full | `npm run e2e:api` / `e2e:playwright` | **не гонялись** (нужен живой stack) |
| Staging credentials probe | `npm run staging:credentials-probe` | **не симулировался** |

Typecheck: в CI помечен как informational; baseline ratchet в `scripts/typecheck-mobile.sh`. Не merge-blocker этого отчёта, но открытый долг.

---

## 6. Нерешённые blockers / риски

1. **PR #27 на GitHub всё ещё с `down_revision = w4jtipurge01`.** Мерж #27 в `main` **до** #26 или без rebase parent → **два Alembic heads**. Нужно запушить fix на `agent/portal-payment-evidence` либо мержить только через integration.
2. Mobile **typecheck** residual errors.
3. Full **Playwright / e2e:api** на integration не прогонялись локально.
4. Staging credentials / JWT — только checklist ниже.

---

## 7. Manual staging checklist (не симулировать)

1. Login через production-like JWT  
2. Переключение проектов  
3. Calendar error/retry  
4. Reports error/retry  
5. Selections stale state  
6. OCR health (`GET /api/v1/ocr/health`)  
7. My Nalog production guard (bypass must fail closed)  
8. Warranty double tap (idempotency key)  
9. Payment receipt upload  
10. MIME validation  
11. Unauthorized receipt access  
12. Approve / reject / resubmit evidence  
13. Sentry sanitization (no tokens in events)  
14. `npm run staging:credentials-probe`

---

## 8. Рекомендуемый порядок merge в `main` (без auto-merge)

**Вариант A — через integration (предпочтительно):**

1. Draft PR: `integration/data-honesty-release` → `main`  
2. Дождаться CI (Quality + E2E/Alembic Postgres)  
3. Пройти manual staging checklist  
4. Merge **одного** integration PR  
5. Закрыть PR #24–#28 как superseded

**Вариант B — по одному PR:**

1. Merge #24 → #25 → #26  
2. **Сначала** обновить PR #27: `down_revision = "w5warranty01"`, дождаться CI  
3. Merge #27  
4. Merge #28  
5. После каждого шага: `alembic heads` == 1

**Запрещено:** merge #27 в `main` с текущим GitHub head без fix parent.

---

## 9. Rollback plan

| Слой | Действие |
|------|----------|
| Git | `git revert` merge commit(s) **или** deploy на `09b16cb2` |
| Alembic | `alembic downgrade w5warranty01` → полный откат warranty: `alembic downgrade w4jtipurge01` |
| Data | DROP `payment_evidence` / `warranty_claim_idempotency` при соответствующих downgrade; payments history beyond `lock_version` column drop не трогается |
| Flags | OCR/My Nalog выключить без миграций |
| Dual-head | Не делать `upgrade head` пока heads > 1; починить `down_revision` |

---

## 10. Воспроизводимые команды

```bash
git fetch origin
git checkout integration/data-honesty-release
cd backend && PYTHONPATH=. .venv/bin/alembic heads
npm run test:guards
npm run test:warranty && npm run test:payment-evidence && npm run test:docs-meta
npm run secret:scan
npm run verify:ci
# Postgres clean chain — §4
```

---

## 11. Acceptance vs criteria

| Criterion | Status |
|-----------|--------|
| Один Alembic head | **PASS** (`w6payev01`) |
| Clean upgrade base→head (Postgres) | **PASS** |
| Downgrade -1 / upgrade head | **PASS** |
| Targeted + guards + verify:ci зелёные | **PASS** |
| PR #27 не в main до fix down_revision | **PASS** |
| Report с командами | **PASS** |
| Auto-merge не выполнен | **PASS** |
