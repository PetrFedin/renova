# Ops remaining (after split on `main`)

**Baseline:** `main` @ 0.3.7 (post #23). Split slices #5–#15 + ops #16–#23 **merged**.

## Code-complete vs production-ready

| | |
|--|--|
| **Code-complete** | Slices + Bearer E2E + H0 checks + QC/schedule в репозитории |
| **Production-ready** | Staging/prod **host** secrets, signing, Sentry, backup drill — см. `docs/PRODUCTION-READINESS-2026-07.md` |

## Staging secrets (human — вне Git)

```bash
ENVIRONMENT=staging npm run staging:credentials-probe
npm run h0:check:strict
API_BASE=https://… npm run h0:check:live
```

Synthetic (без локального `.env`):

```bash
ENV_FILE=/dev/null ENVIRONMENT=staging … bash scripts/staging-credentials-probe.sh
```

## E2E auth (on main)

`authHeaders(DemoUser)` + CI `npm run assert:e2e-bearer`.

## Open product Drafts (не ops-complete)

| PR | Тема |
|----|------|
| #24 | data honesty |
| #25 | capability truth / My Nalog |
| #26 | warranty fail-closed |
| #27 | portal payment evidence |

## Local CI mirror

```bash
npm run verify:ci
```

Не утверждать «CI исправлен» без зелёного GitHub Actions run / локального `verify:ci` evidence.
