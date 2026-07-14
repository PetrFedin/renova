# Renova — детальный план приоритетов (после A-01 / A-03)

**Дата:** 2026-07-15  
**Ветка:** `develop`  
**Репозиторий:** https://github.com/PetrFedin/renova  
**Предыдущий коммит:** `e4ae9ee` (offline + plan/fact)

---

## Цель

Довести Renova от «сильного dev-прототипа (~68%)» до состояния, пригодного для **staging / TestFlight**, с прозрачным backlog и код+доки в git.

| Приоритет | ID | Тема | Целевой результат | Документ |
|-----------|-----|------|-------------------|----------|
| P0 | A-06 | Environment profiles | staging/prod не поднимаются на SQLite+seed | `ENVIRONMENT-PROFILES.md` |
| P0 | D-01…D-07 | Canonical documents | `ProjectDocument` + version + sign stub + E2E | `DOCUMENT-LIFECYCLE-AUDIT-RU.md` |
| P1 | A-04 / A-07 | Route registry | typed registry, secondary centers достижимы | `ROUTE-REGISTRY.md` |
| P1 | A-05 | Router grouping | доменные группы (без смены URL) | этот план §A-05 |
| P2 | merge | develop → main | checklist + готовность PR | `MAIN-MERGE-CHECKLIST.md` |

---


## Волна merge-cut (2026-07-15) — in progress

| Шаг | Статус | Док / артефакт |
|-----|--------|----------------|
| CI uvicorn e2e | DONE `edb91d0` | `CI-E2E-FIX-2026-07-15.md` |
| CI NotificationType | DONE `da674dc` | `CI-NOTIFICATION-TYPE-FIX-2026-07-15.md` |
| CI Alembic dep | DONE `b1f96b4` | `CI-ALEMBIC-DEP-FIX-2026-07-15.md` |
| Green CI на PR #2 | DONE | https://github.com/PetrFedin/renova/pull/2 |
| Merge develop→main | DONE `9cc3cc7` | `RELEASE-v0.2-MERGED.md` |
| Tag v0.2.0 + notes | DONE | https://github.com/PetrFedin/renova/releases/tag/v0.2.0 |


## Уже закрыто

### A-01 Canonical offline — DONE (`e4ae9ee`)
- Один key: `renova_offline_queue`
- Façade `lib/offline/*`
- Legacy migration
- Flush: 409 / permanent 4xx / 5xx retry
- `npm run test:offline`

### A-03 Plan vs fact — DONE (`e4ae9ee`)
- Schedule card = план
- Stage / `stageFactPercent` = факт
- Без плана нет фейкового «0% работ»

---

## A-06 — Environment profiles (P0)

### Проблема
По умолчанию: SQLite + `create_all` + demo seed + `PUBLIC_BASE_URL=127.0.0.1`.  
Риск: случайный деплой «как localhost».

### Profiles

| Profile | SQLite | create_all | demo seed | PUBLIC_BASE_URL | SECRET_KEY |
|---------|--------|------------|-----------|-----------------|------------|
| `development` | OK | OK | OK | localhost OK | soft warn |
| `test` | OK | OK | optional | any | any |
| `staging` | **forbid** | **forbid** | **forbid** | **required** non-localhost | **required** ≠ default |
| `production` | **forbid** | **forbid** | **forbid** | **required** https | **required** strong |

### Deliverables
1. `backend/app/core/environment.py` — `validate_runtime_settings()`
2. Gate in `init_db()` / `lifespan`
3. `.env.example` с блоками profile
4. `backend/tests/test_environment_guards.py`
5. Health endpoint: `"environment": settings.environment`

### Acceptance
- `ENVIRONMENT=production` + sqlite → startup **fail**
- `ENVIRONMENT=development` + sqlite → OK + seed
- Документ `ENVIRONMENT-PROFILES.md` в git

---

## D-01…D-07 — ProjectDocument (P0)

### Целевые сущности
- `ProjectDocument` — канон
- `DocumentVersion` — файлы / MIME / checksum
- `DocumentSignature` — stub (роль, at, hash)

### Lifecycle statuses
`draft` → `active` → `superseded` | `archived` | `deleted`

### Types (enum)
`acceptance_act` | `design_package` | `receipt` | `estimate` | `contract` | `invoice` | `warranty` | `other` | `upload`

### API (поверх index)
- `GET /projects/{id}/documents` — index + canonical rows
- `POST /projects/{id}/documents` — upload metadata + version
- `POST /projects/{id}/documents/{doc_id}/versions`
- `POST /projects/{id}/documents/{doc_id}/sign` — stub signature
- `POST /projects/{id}/documents/{doc_id}/archive`

### Auto-hooks
- При accept work acceptance → создать/обновить документ `acceptance_act`

### E2E (D-07)
Smoke: после accept → documents содержит `acceptance_act` с `href` на PDF act  
+ чужой project → 404  
+ viewer read-only может GET, не POST

### Acceptance
- Migration alembic
- Unit tests service
- Docs audit статусы D-01…D-03 → in progress / done

---

## A-04 / A-07 — Route registry (P1)

### Typed fields
```ts
{
  id, path, titleRu,
  audience: 'customer' | 'contractor' | 'both',
  visibility: 'dock' | 'more' | 'hidden' | 'deeplink',
  status: 'ga' | 'beta' | 'wip',
  entryPoints: string[],
}
```

### Правила
- Dock ≤ 4 canonical tabs
- Secondary centers (`finance-center`, `manager-dashboard`, `quality-control`, `work-acceptance`, `work-schedule`, `documents`, `notifications`) → `visibility: 'more'`, status `beta|ga`
- WIP не в меню

### Deliverables
- `apps/mobile/lib/routeRegistry.ts`
- Home «Дополнительно» строится из registry
- `docs/ROUTE-REGISTRY.md`
- Простой node-тест: все `more`/`dock` имеют path + title

---

## A-05 — Backend router grouping (P1, soft)

Без смены URL. Только комментарии-секции / optional domain includes:

```
# --- core ---
# --- project execution ---
# --- finance ---
# --- content / admin ---
```

Полный split файлов — отдельный task, не блокер staging.

---

## Merge develop → main (P2)

См. `MAIN-MERGE-CHECKLIST.md`.  
**Не мержить автоматически**, пока:
1. A-06 green
2. Document P0 smoke green
3. `npm run test:offline` green
4. e2e-smoke green на develop

---

## Scorecard target после этого прогона

| Критерий | Было | Цель |
|----------|------|------|
| Offline | 6 | 6 |
| Единый источник данных | 6 | 6 |
| Environment / deploy | 4 | **7** |
| Documents domain | ~3 | **6** |
| Навигация | 6 | **7** |
| Общая готовность | 68% | **74%+** |

---

## Порядок коммитов (рекомендуемый)

1. docs: priority plan + checklists  
2. feat(A-06): environment profiles  
3. feat(D): project documents model+api+hooks  
4. feat(nav): route registry  
5. docs: audit score updates  

Все — в `develop`, push на GitHub.

---

## Execution log — 2026-07-15

| Item | Commit target | Result |
|------|---------------|--------|
| A-06 env profiles | `environment.py` + guards + tests | done |
| D-01…D-03 models | `project_documents.py` + alembic | done |
| D API + accept hook | documents API + work_acceptances | done |
| D-07 e2e | smoke asserts acceptance act | done |
| A-04/A-07 registry | `routeRegistry.ts` + Home more | done |
| A-05 router | section comments | done |
| Docs | ENVIRONMENT / ROUTE / MAIN-MERGE / audits | done |
| Merge main | checklist only | deferred |

### Verify locally

```bash
npm run test:offline
npm run test:routes
cd backend && PYTHONPATH=. python -m pytest tests/test_environment_guards.py tests/test_project_documents.py -q
```


---

## Execution log — 2026-07-15 Wave 2

| Item | Result | Docs |
|------|--------|------|
| D-06 multipart upload | done | `DOCUMENT-CENTER-WAVE2.md` |
| D-04 restore + soft-delete | done | same |
| D-07 privacy + viewer RO e2e | done | e2e-smoke.sh |
| Mobile FormData + upload API | done | documents.ts / client.ts |
| Merge main | still deferred | `MAIN-MERGE-CHECKLIST.md` |

Score: documents ~7.5 · overall ~77%.


---

## Execution log — 2026-07-15 Wave 2.1 / Wave 3 start

| Item | Result |
|------|--------|
| Fix API crash (python-multipart missing in venv) | done — see `INCIDENT-2026-07-15-API-MULTIPART.md` |
| Harden `start-dev.sh` auto-install multipart | done |
| Media nested document paths | done — `DOCUMENT-CENTER-WAVE3.md` |
| Soft ACL on documents/* media | done (X-User-Id required) |

---

## Wave 3 — media ACL + legal hold (2026-07-15) — DONE

- Membership check на `GET /api/v1/media/documents/…` (privacy 404)
- Legal hold MVP: колонки + API + 409 на delete
- E2E расширен; результаты в `E2E-SMOKE-RESULTS-2026-07-15.md`
- Оценка готовности архитектуры: ~80% (media leak закрыт; OCR/e-sign ещё open)

### Следующий приоритет

1. OCR classify stub (async job flag на DocumentVersion)
2. E-sign provider interface (stub)
3. Merge develop → main по checklist (осознанный PR, не auto)

---

## Wave 3b — OCR stub + e-sign providers (2026-07-15) — DONE

- `document_ocr_service.py` + поля на `DocumentVersion`
- Upload auto-classify (эвристики); `GET/POST …/ocr`
- `esign/` registry: in_app + kontur/goskey stubs; `GET /esign/providers`; sign → 501 для stubs
- Docs: `DOCUMENT-CENTER-WAVE3B.md`
- Score: Document Center ~8.2 · overall ~82%

### Следующий приоритет

1. (Опционально) OCR async worker + реальный engine
2. Merge `develop` → `main` по `MAIN-MERGE-CHECKLIST.md` (осознанный PR)
3. TestFlight notes / staging env smoke на non-sqlite

---

## Wave merge-prep — develop→main package (2026-07-15) — DONE (PR, no auto-merge)

- SECRET audit evidence + staging/production env templates
- `scripts/merge-readiness.sh`, `scripts/staging-env-smoke.sh`
- Docs: `MERGE-DEVELOP-TO-MAIN.md`, `STAGING-SMOKE.md`, `TESTFLIGHT-NOTES-v0.2.md`
- Checklist criteria closed; **merge только после PR review**
- Score overall ~84% (код на develop готов; main ждёт human merge)

### Следующий приоритет

1. Review + merge PR develop→main + tag `v0.2.0`
2. Staging Postgres live smoke (`API_BASE=…`)
3. Post-release: OCR worker / Kontur SDK (не блокер)

---

## Wave 3c — OCR async worker + staging Postgres smoke (2026-07-15) — DONE

- `DOCUMENT_OCR_MODE=sync|async` + worker tick/loop
- Fixed `docker-compose.yml`; added `docker-compose.staging.yml` (:5435)
- `scripts/staging-postgres-smoke.sh` / `npm run staging:postgres`
- Docs: `DOCUMENT-CENTER-WAVE3C.md`, `STAGING-POSTGRES-SMOKE.md`
- PR #2 remains open for human merge
- Score ~86% (Postgres staging path proven locally)

### Следующий приоритет

1. Human merge [PR #2](https://github.com/PetrFedin/renova/pull/2) + tag `v0.2.0`
2. Deploy real staging + `API_BASE=…` smoke
3. Kontur / real OCR engine (post-release)

---

## Wave 3d — Mobile Document Center actions (2026-07-15) — DONE

- Hub: upload + sign/OCR/legal-hold/archive на canonical docs
- API client + meta helpers + `test:docs-meta`
- Docs: `DOCUMENT-CENTER-WAVE3D.md`
- Score ~88% (product path через мобильный индекс закрыт; main ждёт merge)

### Следующий приоритет

1. Human merge [PR #2](https://github.com/PetrFedin/renova/pull/2) + tag `v0.2.0`
2. Native DocumentPicker для upload на iOS/Android
3. Kontur SDK / real OCR engine

---

## Wave 3e — Native DocumentPicker (2026-07-15) — DONE

- `expo-document-picker` + `documentUploadPick.ts`
- Hub: native file/photo source Alert
- Docs: `DOCUMENT-CENTER-WAVE3E.md`
- Score ~89%

### Следующий приоритет

1. **Human merge** [PR #2](https://github.com/PetrFedin/renova/pull/2) + tag `v0.2.0` — сказать «мержи PR #2»
2. Contour SDK / real OCR
3. TestFlight build notes publish after tag

---

## Wave 3f — Kontur/Goskey scaffold + release prep (2026-07-15) — DONE

- Env-gated kontur/goskey (`KONTUR_MODE` / `GOSKEY_MODE`)
- Pending signatures + webhooks `/api/v1/esign/webhooks/*`
- `RELEASE-v0.2-PREP.md`, `scripts/release-notes-v0.2.sh`
- Default: kontur still 501 (e2e unchanged)
- Score ~90%

### Следующий приоритет

1. Напиши **мержи PR #2** → merge + tag `v0.2.0`
2. Staging secrets + optional KONTUR_MODE=sandbox
3. Real Kontur HTTP SDK / TestFlight build

---

## Release cut — merge main + CI fix (2026-07-15)

- Fix CI: `poetry run uvicorn` (см. `CI-E2E-FIX-2026-07-15.md`)
- Merge PR #2 → `main`, tag `v0.2.0`


## Post-v0.2 backlog (новый приоритет)

1. TestFlight — `TESTFLIGHT-NOTES-v0.2.md`
2. Kontur/Goskey live HTTP
3. Production OCR engine
4. poetry.lock + alembic (без pip sidecar в CI)
5. EAS build workflow (сейчас fail вне merge gate)
