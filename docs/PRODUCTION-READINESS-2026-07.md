# Production readiness — Renova (2026-07)

**Канон базы:** ветка `main`  
**Baseline commit (на момент этого документа):** `09b16cb2` — Merge PR #23 (`utc_now` + test alignment), app/API **0.3.7**  
**Не путать:** *code-complete на main* ≠ *production-ready на хосте*.

## 0. Статус релиза (факты)

### Merged release slices → `main`

| Slice / тема | PR | Tag / note |
|--------------|----|------------|
| security-acl | #5 | v0.3.1 |
| acceptance-schedule | #7 | v0.3.2 |
| payments | #9 | v0.3.3 |
| offline | #11 | v0.3.4 |
| documents-fns | #13 | v0.3.5 |
| ia-portal | #15 | v0.3.6 |
| mobile parity | #16 | — |
| hygiene ws/docs | #17 | — |
| e2e JWT Bearer | #18 | — |
| ops probe / e2e assert | #19 | — |
| H0 Bearer live | #20 | — |
| schedule plan-item CTAs | #21 | — |
| QC IssueFixed notify | #22 | — |
| utc_now + tests | #23 | v0.3.7 |

### Архив (не reopen)

| Item | State |
|------|--------|
| Mega PR #3 «DO NOT MERGE (mega): Release P3…» | **CLOSED** — только split slices |
| Mega merge develop→main #2 | historical, 2026-07-14 |

### Open Draft PR (ещё **не** в `main`)

| PR | Branch | Тема |
|----|--------|------|
| #24 | `agent/data-honesty-stability` | honest loading / errors |
| #25 | `agent/capability-truth-guards` | OCR truth + My Nalog prod-safe |
| #26 | `agent/warranty-fail-closed` | warranty fail-closed + idempotency |
| #27 | `agent/portal-payment-evidence` | payment receipt evidence |

Не создавайте дублирующие `release/*` ветки под уже merged slices.

### Code-complete vs production-ready

| | Code-complete (`main`) | Production-ready |
|--|------------------------|------------------|
| Смысл | Срезы и ops-гигиена в репозитории | Хост + secrets + store signing + staging smoke |
| Блокеры | Open Draft #24–#27 (продукт) | Внешние credentials на хосте (см. §16) |
| Доказательство | CI зелёный на PR + `npm run verify:ci` | Probe/live H0 + EAS build + backup drill |

---

## 1. Актуальный commit baseline

- Проверка: `git rev-parse origin/main` → должен совпадать с тем, от чего открыт release PR.
- Версии: mobile `apps/mobile/app.json` → `0.3.7`; API `/health.version` → `0.3.7`.
- Evidence: `git log -1 --oneline origin/main`, скрин/лог CI на этом SHA.

## 2. Mobile readiness

| Пункт | Status | Evidence |
|-------|--------|----------|
| Expo / router IA на main | code-complete | #15–#16 |
| EAS profiles без localhost в preview/testflight/prod | config | `npm run testflight:eas` |
| Public env fail-fast (staging/prod) | hardening | `apps/mobile/lib/envSchema.ts` |
| Sentry только с DSN + sanitization | hardening | `sentryInit` + tests |
| Store signing / ASC / Play | **external** | Apple/Google credentials вне Git |

## 3. Backend readiness

| Пункт | Status | Evidence |
|-------|--------|----------|
| FastAPI + profiles A-06 | code-complete | `environment.py` + `test_environment_guards` |
| Production fail-fast env | hardening | `validate_runtime_settings` + capability rules |
| JWT Bearer на staging/prod | code-complete | #18–#20 |
| Demo seed / SQLite в prod | запрещены | policy production |

## 4. Database migrations

| Пункт | Status | Evidence |
|-------|--------|----------|
| Alembic upgrade на Postgres | CI smoke | job `e2e` → `alembic upgrade head` |
| Heads single | CI | `alembic heads` count == 1 |
| Prod apply | **ops** | `scripts/migrate.sh` на хосте до uvicorn |

## 5. File storage

| Пункт | Status | Evidence |
|-------|--------|----------|
| Local uploads (dev) | OK | `UPLOADS_DIR` |
| S3 provider-specific | optional until `S3_ENDPOINT` set | then `S3_ACCESS_KEY`/`S3_SECRET_KEY`/`S3_BUCKET` required |
| CloudFront signed URLs | optional | `CLOUDFRONT_*` — не в Git |

## 6. Notifications

| Пункт | Status | Evidence |
|-------|--------|----------|
| In-app / outbox | code-complete | backend notification types tests |
| Push (Expo) | ops | Expo push token / project — EAS secrets |
| SMS (Twilio) | provider-specific | если `TWILIO_SID` → token/from обязательны |
| SMTP | optional | без host — log stub |

## 7. OAuth

| Пункт | Status | Evidence |
|-------|--------|----------|
| «Мой налог» scaffold | code-complete | empty → `oauth_ready=false` |
| Live OAuth | provider-specific | `MOY_NALOG_ENABLED=true` → client/secret/redirect/token_url |
| Dev bypass | **запрещён в production** | только non-prod flags (см. open #25) |

## 8. Payments

| Пункт | Status | Evidence |
|-------|--------|----------|
| Manual / portal flows | code-complete на main | slice payments #9 |
| YooKassa | provider-specific | shop+secret; webhook secret если shop задан |
| Card checkout без ключей | 503 (ожидаемо) | `collect_warnings` |
| Receipt evidence | **open Draft #27** | не считать merged |

## 9. OCR

| Пункт | Status | Evidence |
|-------|--------|----------|
| Stub / local mode | code-complete | sync default |
| Async worker | optional | `DOCUMENT_OCR_MODE=async` |
| External OCR provider keys | provider-specific | не требовать, пока capability off |
| Truthful capability UI | **open Draft #25** | |

## 10. Sentry / monitoring

| Пункт | Status | Evidence |
|-------|--------|----------|
| Init только при DSN | required | mobile + backend |
| Production без DSN | **blocked** unless `SENTRY_APPROVED_WITHOUT_DSN=true` | explicit exception |
| beforeSend sanitization | required | no tokens/PII payloads |
| environment + release | required | APP version / git SHA |
| debug verbose в prod | запрещён | |

## 11. Apple / Android signing

| Пункт | Owner | GitHub? |
|-------|-------|---------|
| Apple Distribution / ASC API key | Release owner | **Нет** — EAS / ASC only |
| Android keystore | Release owner | **Нет** |
| `EXPO_TOKEN` | CI/CD | GitHub Actions **secret**, не в коде |

## 12. Staging

| Пункт | Status | Evidence |
|-------|--------|----------|
| Credentials probe | ops script | `npm run staging:credentials-probe` |
| H0 live Bearer | ops | `npm run h0:check:live` |
| Synthetic CI probe | local/CI | `ENV_FILE=/dev/null ENVIRONMENT=staging …` |
| Real host secrets | **blocker** | человек на сервере |

## 13. Backup / restore

| Пункт | Status | Evidence |
|-------|--------|----------|
| Scripts | present | `scripts/backup.sh`, `pitr-*.sh`, `backup-s3.sh` |
| Drill на staging | **ops** | лог restore drill с датой |
| Cron | ops | `cron-backup.sh` |

## 14. Security

| Пункт | Status | Evidence |
|-------|--------|----------|
| `.env` gitignored | OK | `.gitignore` |
| Secret scan в CI | hardening | `scripts/secret-scan.sh` |
| No prod credentials in PR workflows | policy | CI uses synthetic secrets only |
| Fork PR не деплоит | policy | EAS `workflow_dispatch` only + fork guard |
| Active secret in git | scan на PR | path+type only; rotate out-of-band |

### Credentials, которые **нельзя** хранить в GitHub (даже private repo как «канон»)

`SECRET_KEY`, DB passwords, `YOOKASSA_*`, `S3_SECRET_KEY`, `KONTUR_API_KEY`, `MOY_NALOG_CLIENT_SECRET`, `TWILIO_TOKEN`, Apple `.p8` / keystore, Telegram bot tokens, service-account JSON, raw Sentry auth tokens (DSN публичный client — отдельно; server auth token — secret).

## 15. Go / no-go checklist

**GO только если все обязательные строки = PASS с evidence.**

| # | Check | Required |
|---|-------|----------|
| G1 | `origin/main` baseline documented | yes |
| G2 | `npm run verify:ci` green | yes |
| G3 | CI workflow required jobs green | yes |
| G4 | Alembic head single + upgrade smoke | yes |
| G5 | Secret scan clean | yes |
| G6 | Staging probe PASS на реальном host | yes (prod) |
| G7 | EAS testflight/production profile URLs HTTPS non-localhost | yes |
| G8 | Sentry DSN set **or** signed `SENTRY_APPROVED_WITHOUT_DSN` | yes |
| G9 | Backup restore drill ≤ 30 дней | yes (prod) |
| G10 | Open Draft #24–#27 осознанно in/out of scope | yes |

## 16. Owner внешних настроек

| Setting | Owner role |
|---------|------------|
| Postgres / `DATABASE_URL` | Backend / DevOps |
| `SECRET_KEY`, JWT TTL | Backend |
| S3 / CloudFront | DevOps |
| YooKassa shop/webhook | Payments owner |
| Kontur / Goskey | Legal/e-sign owner |
| Moy nalog OAuth | Product + FNS partnership |
| Twilio / SMTP | Ops |
| Sentry org/project/DSN | Eng lead |
| Apple / Google / EAS | Mobile release owner |
| CORS / `PUBLIC_BASE_URL` / portal URLs | Backend + Mobile |

## 17. Evidence required для закрытия пункта

Для каждого пункта §15–§16 в PR/runbook указывайте:

| Field | Example |
|-------|---------|
| Check | Alembic upgrade head |
| Result | PASS / FAIL / BLOCKED / N/A |
| Evidence | CI run URL, command output hash, dated ops log — **не** secret values |

Не ставьте «готово», если Evidence пустой.

---

## Связанные документы

- `docs/SPLIT-RELEASE-PR-PLAN-2026-07-21.md` — slices complete; mega archived
- `docs/AUDIT-OPS-REMAINING-2026-07-21.md` — staging human blockers
- `docs/ENVIRONMENT-PROFILES.md` — A-06 profiles
- `docs/RELEASE-v0.3.7.md` — current version notes
- `docs/SECURITY-REMEDIATION.md` — если найден активный secret
