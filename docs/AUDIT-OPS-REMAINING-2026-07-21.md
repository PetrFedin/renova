# Ops

Split + mobile parity on `main`. Only staging secrets left:

`ENVIRONMENT=staging npm run staging:credentials-probe`

## E2E auth (PR #18)

API Playwright specs use `authHeaders(DemoUser)` — JWT Bearer when `/auth/demo` returns `access_token`, so gates work when staging forbids `X-User-Id`. Fallback to `X-User-Id` only for local/dev without token.
