# Ops

Split + mobile parity on `main`. E2E JWT Bearer landed (#18).

## Staging secrets (human)

`ENVIRONMENT=staging npm run staging:credentials-probe`

Probe now also fails closed on: `AUTH_ALLOW_HEADER_USER_ID=true`, SQLite `DATABASE_URL`, default/short `SECRET_KEY`, localhost `PUBLIC_BASE_URL`, `CORS=*`, `ALLOW_DEMO_SEED`.

Synthetic check without local `.env`:

`ENV_FILE=/dev/null ENVIRONMENT=staging … bash scripts/staging-credentials-probe.sh`

## E2E auth (on main)

API Playwright specs use `authHeaders(DemoUser)`. CI gate: `npm run assert:e2e-bearer` (no raw `'X-User-Id'` in `e2e/*.spec.ts`).
