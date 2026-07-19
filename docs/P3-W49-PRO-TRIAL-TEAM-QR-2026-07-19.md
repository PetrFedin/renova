# P3-W49 — Pro trial 14д + Team QR роли (2026-07-19)

## Зачем (H1.1 / H1.5)

Инвестор и пилот видят **честную монетизацию**: trial без карты → paywall с badge live/demo/off.  
Бригада: QR с ролью (рабочий / прораб / наблюдатель) без тупика «сначала создайте команду».

## Сделано

| Область | Изменение |
|---------|-----------|
| `subscription_service` | `start_trial`, `trial_used`, `subscription_payload`, expire |
| `POST /subscription/start-trial` | 14 дней Pro один раз |
| `GET /subscription/me` | is_trial, trial_available, payments_mode, days_left |
| Checkout return | `renova://subscription-return` (не localhost) |
| Demo activate | Только development; явный message |
| UI Subscription | Benefits + trial CTA + honesty badge |
| `POST /teams/invite-link` | `role` + auto-create бригады |
| UI Team QR | Выбор роли, copy/share, refresh QR |

## Проверка

```bash
cd backend && PYTHONPATH=. .venv/bin/pytest -q tests/test_subscription_trial.py
```

## Ops (не код)

- YOOKASSA_* на staging → `payments_mode: live`
- TestFlight HTTPS API (H0)
