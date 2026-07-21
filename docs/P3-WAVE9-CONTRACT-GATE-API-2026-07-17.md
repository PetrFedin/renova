# P3-WAVE9 — Contract gate API + portal pay refresh (2026-07-17)

## Закрыто

| ID | Задача |
|----|--------|
| P3-W9.1 | `GET /projects/{id}/contract-gate` — статус до start_stage |
| P3-W9.2 | StageDetailHero — баннер «Подпишите договор» + ссылка `/documents` |
| P3-W9.3 | Portal — refresh snapshot после закрытия ЮKassa browser + AppState focus |

## Тесты

```bash
cd backend && .venv/bin/python -m pytest tests/test_contract_gate.py -q
```

## Следующий (P3-W10)

- Estimate lock + auto contract draft
- Portal return_url → web portal с `?paid=1`
- Push заказчику при pending contract
- E2E: gate → documents → sign → start stage
