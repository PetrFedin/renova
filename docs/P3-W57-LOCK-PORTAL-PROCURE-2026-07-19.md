# P3-W57 — Mutual lock, portal schedule, procurement gate (2026-07-19)

После W55/W56.

## Сделано

| Тема | Изменение |
|------|-----------|
| Estimate | Contractor `POST …/estimate/propose-lock`; only customer `POST …/lock` |
| DB | `estimate_lock_proposed_at/by` + alembic `x8y9z0a1b2c3` |
| Portal | `pending_work_schedule` + confirm/reject endpoints + UI CTA |
| Acceptance | Banner → `repair?tab=control` (same as nextAction) |
| Procurement | `create_from_picks` only approved → 409 `picks_not_approved` |
| Budget fact | purchase-aware pick dedupe in expense analytics (W56 follow-up) |

## Не в этой волне

H0 ops (HTTPS + live YuKassa + TestFlight).

## Проверка

```bash
cd backend && PYTHONPATH=. .venv/bin/python -m pytest tests/test_estimate_lock_w57.py tests/test_purchase_picks_gate_w57.py -q
```
