# Ops

Split + mobile parity on `main`. E2E JWT Bearer landed (#18).

Only staging secrets left:

`ENVIRONMENT=staging npm run staging:credentials-probe`

## E2E auth (on main)

API Playwright specs use `authHeaders(DemoUser)` — JWT Bearer when `/auth/demo` returns `access_token`, so gates work when staging forbids `X-User-Id`. Fallback to `X-User-Id` only for local/dev without token.
