# P3-WAVE10 — Estimate lock + portal pay return (2026-07-17)

## Закрыто

| ID | Задача |
|----|--------|
| P3-W10.1 | `POST /projects/{id}/estimate/lock` — фиксация сметы, блок PATCH/POST lines |
| P3-W10.2 | Auto contract draft `ensure_contract_draft` при lock |
| P3-W10.3 | Push заказчику: lock сметы + блок start_stage без договора |
| P3-W10.4 | YuKassa checkout `portal_token` → return URL `/portal?token=…&paid=1` |
| P3-W10.5 | Mobile: кнопка «Зафиксировать смету» + баннер locked |
| P3-W10.6 | Portal: alert при `paid=1`, checkout с portal_token |

## Миграция

`u5v6w7x8y9z0_estimate_locked.py` — `projects.estimate_locked_at`

## Тесты

```bash
cd backend && .venv/bin/python -m pytest tests/test_estimate_lock.py tests/test_portal_checkout_return.py tests/test_contract_gate.py -q
cd .. && npm run test:priority
```

## Следующий (P3-W11)

- E2E Playwright: lock → sign → start stage
- Registry v3 — удаление legacy tab routes
- Kontur live keys + production webhook
