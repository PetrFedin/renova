# Ops

Split + mobile parity on `main`. E2E JWT (#18). Ops probe/assert (#19).

## Staging secrets (human)

`ENVIRONMENT=staging npm run staging:credentials-probe`
`npm run h0:check:strict` — включает probe + assert-e2e-bearer
`API_BASE=https://… npm run h0:check:live` — H0 readiness по **Bearer JWT** (не X-User-Id)

H0 API check `auth_bearer`: на staging/production identity только JWT.

Synthetic probe: `ENV_FILE=/dev/null ENVIRONMENT=staging … bash scripts/staging-credentials-probe.sh`

## E2E auth (on main)

`authHeaders(DemoUser)` + CI `npm run assert:e2e-bearer`.
