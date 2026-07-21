# Audit wave-9 — P1 embed (2026-07-21)

## Встроено

| ID | Что | Зачем |
|----|-----|--------|
| P1.15 | `acceptance_policy` quick/full; inline → 409 `checklist_required` | Hub не принимает этапы с незакрытым чек-листом |
| P1.16 | `domain_outbox` + enqueue на accept (app/portal) | Notify/activity после commit, retry при сбое |
| P1.9 | OTP → Redis при `REDIS_URL`, иначе memory | Multi-instance staging |
| P1.8 | `POST /auth/sessions/revoke-all` + кнопка в профиле | Выход на всех устройствах |
| P1.14 | `getLastCachedGetMeta()` + reportError на stale fallback | Cache не маскирует ошибку без сигнала |

## Env

```bash
REDIS_URL=redis://127.0.0.1:6379/0   # OTP + WS bridge
```

## Mobile

- `UnifiedAcceptanceList` шлёт `mode: inline`
- Stage accept шлёт `mode: full` + checklist texts
- Профиль → «Выйти на всех устройствах»

## Тесты

```bash
cd backend && .venv/bin/pytest \
  tests/test_acceptance_policy.py \
  tests/test_otp_redis_fallback.py \
  tests/test_otp_rate_limit.py \
  tests/test_outbox_enqueue.py -q --noconftest
```
