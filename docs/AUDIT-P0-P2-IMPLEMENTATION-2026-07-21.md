# Audit P0–P2 implementation (2026-07-21)

Pin: see `git rev-parse HEAD` after merge.

## Embedded in code

| # | Change |
|---|--------|
| 2 | Refresh tokens + `user_sessions`; staging/prod access TTL ≤20m; mobile no `X-User-Id` outside development/test; 401→refresh retry |
| 3 | H0 readiness returns `git_sha` + `checked_at`; `npm run staging:readiness-report` |
| 4 | Durable webhook idempotency (`payment_webhook_events`); `payment_events` audit; `payment_method` on confirm |
| 5 | Chat honesty: «опрос 15 с» when WS down (endpoint already exists) |
| 6 | Fail-closed stage deps; materials `loading/loaded/error` |
| 7 | Offline banner «Не синхронизировано: N» |
| 9 | Мой налог honesty copy + `mode` in API |
| 10 | `receipts.verification_status` enum string |
| 11 | Document Center mode chips OCR/Kontur/подпись |
| 13 | Chat «Другая сумма…» → payment form |
| 14 | Portal subtitle «просмотра и согласований» |
| 15 | `X-Request-Id` / `X-Correlation-Id` middleware |

## Still ops / follow-up

- #1 split PR develop→main + tags
- #3 live `h0:check:live` against real staging HTTPS
- Full OAuth Мой налог; Redis WS pub/sub; portal chat/CO
- Sentry DSN on staging mobile+backend

## Migration

`alembic upgrade head` → revision `y9z0a1b2c3d4`

## Wave 2 (same day)

- paid_unverified SM; portal CO approve/reject; invoice ACL; budget/manager fail-closed; secure token store; reportError
- Split PR plan: `docs/SPLIT-RELEASE-PR-PLAN-2026-07-21.md`
