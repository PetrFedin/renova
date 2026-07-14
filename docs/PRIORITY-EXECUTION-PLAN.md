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
