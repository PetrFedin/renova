# Merge checklist — P3 (develop → main)

## Автоматически

```bash
npm run merge:check
npm run release:notes:v0.3
```

Включает: `test:priority`, API e2e, Playwright UI (portal + contract gate), staging smoke.

## Ручное перед PR

- [ ] Backend staging: `docs/STAGING-KONTUR.md` — env и webhook
- [ ] Smoke archive/trash на web после hard refresh
- [ ] TestFlight notes при необходимости

## P3 highlights (develop)

- Project lifecycle (archive/trash, scroll, access_mode)
- Portal + documents E2E (API + browser)
- Contract gate UI banner + API golden path
- Offline: drop queue jobs on archive/trash
- Reports в меню «Ещё»
## CI (P3-W17)

- Job `playwright`: `npm run e2e:api` + UI specs (не `e2e:web || true`)
- Локальная уборка E2E Gate проектов: `npm run cleanup:e2e-gate`


## P3-W18 (CI DRY + hygiene)

- `scripts/ci-playwright.sh` — локально/CI: `npm run ci:playwright` или `e2e:ci`
- После API e2e в `merge:check`: `npm run cleanup:e2e-gate` (best-effort)
- CI: job `test-priority` + playwright steps через `ci-playwright.sh`
## P3-W20

- `npm run merge:check:live` — merge gate с auto-start API
- `npm run ci:push-workflow` — push CI workflow (нужен `gh auth refresh -s workflow`)

## Wave-3 audit embed (2026-07-21)

Pinned SHA: `c555748` (wave-3 on `develop`, 2026-07-21).

Влито в develop (не всё в main):
- OTP rate-limit / verify lockout + auth_audit
- `User.moy_nalog_status` + `/fns/moy-nalog/unlink` (honesty, не fake OAuth)
- `paid_unverified` filter в BudgetPayments + labels
- Scratchpad fail-closed chatInbox
- Optional `REDIS_URL` pub/sub в WS broadcast
- `expo-secure-store` dependency для JWT storage
- sqlite_compat syntax fix (orphan try/except wave-1)

Release still OPEN: split PR develop→main per `docs/SPLIT-RELEASE-PR-PLAN-2026-07-21.md`.

## Wave-4 audit embed (2026-07-21)

Pinned SHA: `428de3e` (+ Alert import fix).

- Redis WS subscribe (`ws_redis_bridge`) + fail-closed chat/offline/stage blocked
- `reportError` → Sentry SDKs optional
- Doc: `docs/AUDIT-WAVE4-IMPLEMENTATION-2026-07-21.md`
