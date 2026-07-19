# P3-W47 — Demo investor path + portal honesty + Home CTA

## Demo seed

- `_ensure_demo_acceptance_queue`: pending WA + stage `review` + `payment_amount`
- Demo login сразу показывает «Принять этап»

## Portal

- Snapshot: `payments_mode` (live|requisites|demo), contractor name
- UI: исполнитель, честный режим оплаты, кнопка карты без ложного live

## Home

- nextAction accept → Repair→Приёмка (`control`)
- HomeAcceptanceBanner не дублирует hero при `kind === 'accept'`

## Tests

`test_demo_seed_w47.py` — 2 passed
