# Integration QA — Renova open PRs (2026-07)

**Дата:** 2026-07-21  
**База:** `main` @ `09b16cb2` (Merge #23, app/API 0.3.7)  
**Integration branch (local, не в main):** `agent/integration-qa-2026-07` @ `7a8b4a43`  
**Сеть GitHub:** на момент прогона `fetch`/`gh` часто timeout — remote CI статусы перепроверять вручную.

## 1. Commit SHAs (исходные PR-ветки)

| PR | Тема | Branch | Tip SHA |
|----|------|--------|---------|
| #24 | data honesty | `agent/data-honesty-stability` | `d724114b` |
| #25 | OCR capability + My Nalog guards | `agent/capability-truth-guards` | `ff8c4335` |
| #26 | warranty fail-closed | `agent/warranty-fail-closed` | `5f39bf2d` |
| #27 | payment evidence | `agent/portal-payment-evidence` | `21e292ba` (+ chain fix) |
| #28 | release hardening | `agent/release-ops-hardening` | `939f5128` |

Все base branch: **`main`**.

## 2. Рекомендуемый порядок merge (точный)

```
#24 data-honesty
 → #25 capability-truth (OCR / My Nalog)
 → #26 warranty (migration w5warranty01)
 → #27 payment evidence  ⚠️ PRE-MERGE: w6payev01.down_revision = w5warranty01
 → #28 release-ops
```

**Не** merge #27 и #26 в произвольном порядке без rechain: оба изначально `down_revision = w4jtipurge01` → **два alembic head**.

На integration ветке rechain уже применён (`w4 → w5 → w6`). На исходном #27 оставлен `w4` + `PRE-MERGE` note + regression test, чтобы standalone CI #27 не ломался до появления файла `w5*`.

## 3. Per-PR audit (кратко)

| PR | Conflicts vs main | Migrations | API contracts | TS types | Generated clients | Tests | Docs |
|----|-------------------|------------|---------------|----------|-------------------|-------|------|
| #24 | clean | none | mobile only | asyncResource | N/A (нет codegen) | asyncResource + failClosed | UI via code |
| #25 | clean | none | OCR health + FNS bypass | `capabilities.ts` | N/A | ocr/moy_nalog + serviceCapabilities | SERVICE-CAPABILITIES |
| #26 | clean vs main; **DocumentsHub** overlaps #25 | `w5warranty01` | warranty create + Idempotency-Key | os.ts / warranty* | N/A | warranty_idempotency + failClosed | WARRANTY-IDEMPOTENCY |
| #27 | clean vs main; **entities** overlaps #26 | `w6payev01` | evidence submit/approve/reject | payments.ts / budget | N/A | payment_evidence + chain test | PORTAL-PAYMENT-EVIDENCE |
| #28 | clean vs main; **environment/config/main/.env** overlaps #25 | none | env fail-fast + Sentry | envSchema | N/A | env_schema + sentry_sanitize | PRODUCTION-READINESS |

**Generated OpenAPI/clients:** в репозитории нет отдельного generated client step для этих PR — контракты = FastAPI routes + mobile `lib/api/*`.

## 4. Integration merge results

| Step | Result | Notes |
|------|--------|-------|
| merge #24 | PASS | clean |
| merge #25 | PASS | auto-merge `package.json` |
| merge #26 | CONFLICT → resolved | `failClosed.w144.test.ts`, `MAIN-MERGE-CHECKLIST.md`, `package.json` — **обе стороны сохранены**; DocumentsHub auto-merge сохранил OCR + warranty |
| merge #27 | CONFLICT → resolved | `package.json` union scripts; **alembic w6→w5** |
| merge #28 | CONFLICT → resolved | `.env.example` OCR + provider notes; `ENVIRONMENT-PROFILES` capability + Sentry |

## 5. Verification suite (integration branch)

| Check | Result | Evidence |
|-------|--------|----------|
| secret-scan | PASS | 0 hits |
| asyncResource / failClosed / serviceCapabilities / warranty / payment-evidence / envSchema / sentrySanitize | PASS | local node/tsx |
| testflight:eas | PASS | easProfiles OK |
| `npm run test:guards` | PASS | **95 passed** |
| targeted backend (ocr, nalog, warranty, payment, media ACL, env, sentry) | PASS | 64 / 37 subsets green |
| alembic heads | PASS | single `w6payev01` |
| migrations empty SQLite from 0 | FAIL (pre-existing) | historical `i9j0k1l2m3n4` SQLite ALTER FK — **не регрессия этих PR** |
| migrations from current schema (stamp w4 → head) | PASS | w5+w6 upgrade |
| migrations re-run | PASS | noop |
| migrations rollback w6→w5→w4 + re-upgrade | PASS | supported |
| Full GitHub Actions on each PR | PENDING | сеть к api.github.com нестабильна; **не утверждать green** |
| `npm run verify:ci` полный | PARTIAL | secret/env/mobile units OK; typecheck informational historically FAIL (147>117) |

## 6. Smoke scenarios

Легенда: **AUTO** = покрыто автотестами/контракт-тестами на integration; **CODE** = проверено чтением кода/юнитами без UI; **STAGING** = нужен живой staging; **EXT** = внешние credentials.

### Calendar (#24)
| Scenario | Result | How |
|----------|--------|-----|
| данные загрузились | AUTO | `asyncResource` success path |
| один endpoint упал | AUTO/CODE | partial failure keeps prior data; failClosed asserts no wipe |
| refresh упал | AUTO | reducer stale/error paths |
| сменился проект | CODE | UnifiedScheduleView resource keyed by project — staging UI confirm |

### Reports (#24)
| daily failed / weekly success / final empty / retry | AUTO/CODE | `_stack/reports.tsx` + ReportPdfActions honesty; UI staging optional |

### Selections (#24)
| empty success / network error / stale warning | AUTO | OsSelectionsScreen + asyncResource + StaleDataBanner |

### OCR (#25)
| live / demo / off / unhealthy | AUTO | `test_ocr_capability.py` + DocumentsHub health UI |

### My Nalog (#25)
| production bypass отсутствует | AUTO | `test_moy_nalog_bypass.py` + env guard |
| development bypass только при env | AUTO | same |

### Warranty (#26)
| list error / one submit / double tap / timeout retry / concurrent duplicate | AUTO | warrantyFailClosed + `test_warranty_idempotency.py` |

### Payments (#27)
| manual transfer / receipt / paid_unverified / approve / reject / resubmit / unauthorized | AUTO | `test_payment_evidence.py` + portal sheet tests |

### Security
| чужой project / attachment / role spoof / MIME / secret redaction | AUTO | media ACL + payment evidence ACL + sentry sanitize + env errors names-only |

## 7. Defects

### Found
1. **CRITICAL — dual alembic heads** если merge #26+#27 без rechain (`w5` и `w6` оба от `w4`).
2. **Merge conflicts** (ожидаемые): DocumentsHub/package.json/env docs между #24–#28.
3. **CI #28 first run:** secret-scan self-match (уже исправлено `939f5128`).
4. **Pre-existing:** full SQLite `alembic upgrade` from empty fails on old chat FK migration; typecheck baseline exceeded.

### Fixed (в исходных / integration)
1. Integration: `w6payev01.down_revision = w5warranty01`.
2. #27 source: PRE-MERGE note + `test_payment_migration_chain.py` + docs section.
3. Conflict resolutions: union tests/scripts/docs (не удаляли функциональность).
4. #28: secret-scan PEM self-match fix (ранее).

### Remaining risks
| Risk | Severity | Mitigation |
|------|----------|------------|
| Забыть rechain #27 после #26 | High | checklist + test fails if w5 present and parent still w4 |
| DocumentsHub auto-merge drift | Medium | failClosed + serviceCapabilities + warranty tests |
| GitHub CI не подтверждён из агента | Medium | человек смотрит Actions |
| Empty SQLite full history | Low/ops | staging Postgres path |
| Sentry DSN exception flag in EAS | Low | PRODUCTION-READINESS §10 |
| Open product Drafts vs production-ready | — | code-complete ≠ prod |

## 8. Go / No-Go

### Verdict: **CONDITIONAL GO**

Можно начинать review/merge **строго в порядке §2**, если:

1. GitHub required checks зелёные на каждом PR tip;
2. Перед merge #27 выполнен rechain `w6 → w5` (или merge commit с тем же эффектом);
3. Staging verification (§10) запланирован до production.

**NO-GO для production cutover** без staging credentials / H0 live / backup drill (см. PRODUCTION-READINESS).

## 9. External credentials (не в Git)

YooKassa, S3, Kontur, Moy nalog OAuth secrets, Twilio, Apple/Google signing, `EXPO_TOKEN`, real `SENTRY_DSN`, Postgres prod URL, webhook secrets.

## 10. Staging verification required

| Item | Why |
|------|-----|
| `npm run staging:credentials-probe` / `h0:check:live` | Bearer + secrets |
| Alembic upgrade on Postgres staging | enum `rejected`, tables w5/w6 |
| OCR health against real API | mode truth |
| My Nalog: confirm bypass 403 in staging | capability |
| Portal payment evidence upload + approve/reject | MIME/ACL |
| Warranty double-submit under latency | idempotency |
| Calendar/Reports/Selections UI smoke | asyncResource UX |
| Sentry event without PII | beforeSend |

## 11. Draft → Ready for review

| PR | Можно Ready? | Условие |
|----|--------------|---------|
| #24 | **Да** | CI green |
| #25 | **Да** | CI green |
| #26 | **Да** | CI green |
| #27 | **Да, с blocker-note** | Ready for review OK; **merge только после #26 + rechain** |
| #28 | **Да** | CI green на tip `939f5128+`; merge последним |

**Авто-merge не выполнять.**

## 12. Integration branch commits

```
7a8b4a43 test(payments): alembic chain regression for warranty+evidence
5ac8b941 integration: merge #28 release-ops-hardening
869dac3e integration: merge #27 portal-payment-evidence
99e24863 integration: merge #26 warranty-fail-closed
e494bc1a integration: merge #25 capability-truth-guards
c8af67a0 integration: merge #24 data-honesty-stability
```

Ветка `agent/integration-qa-2026-07` — **временная QA**; в `main` не пушить как release. После merge slices по порядку — удалить/архивировать.
