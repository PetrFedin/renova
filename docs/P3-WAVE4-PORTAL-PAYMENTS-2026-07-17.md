# P3-WAVE4 — Portal v2, staging payments, CO draft (2026-07-17)

**Ветка:** `develop`  
**Основание:** `P3-WAVE3-FIELD-PAYMENTS-IA-2026-07-17.md`, `RENOVA-COMPETITIVE-GAP-PLAN-2026-07-17.md`

## Закрыто в этой волне

| ID | Задача | Файлы | DoD |
|----|--------|-------|-----|
| Portal v2 | Accept stage по magic link | `portal.py`, `portal_token_service.py`, `portal.tsx`, `misc.ts`, `test_portal_accept.py` | POST accept + кнопка «Принять этап» при scope `accept_stage` |
| Portal v2 | Pay pending в портале | `portal.tsx` | ЮKassa checkout + реквизиты/СБП для pending payments |
| P3.1a | YuKassa staging scaffold | `eas.json` (profile `staging`), `STAGING-URL-CHECKLIST`, `yookassa_service.py` | Demo blocked в staging; checklist с `YUKASSA_SHOP_ID` |
| P3.2d | CO → draft document | `change_orders.py`, `test_co_draft_document.py` | Approve CO → документ «Доп. работы: {title}» status `draft` |
| P3.1d | Kontur webhook idempotent | `project_document_service.py`, `test_esign_providers.py` | Повторный webhook не меняет `signed_at` |

## API

- `POST /api/v1/auth/portal/session` — возвращает `scopes`, `read_only`
- `POST /api/v1/projects/{id}/portal-link` — body `{ "allow_accept_stage": true }`
- `POST /api/v1/portal/projects/{id}/work-acceptances/{acc_id}/accept` — body `{ "token", "comment?" }`

## Тесты

```bash
cd backend && .venv/bin/python -m pytest tests/test_co_budget_line.py tests/test_yookassa_project_payment.py tests/test_portal_accept.py tests/test_co_draft_document.py tests/test_esign_providers.py -q
npm run test:priority
```

## Следующий backlog (P3-W5+)

1. Portal sign act (eSign по magic link)
2. Kontur live webhook (production keys)
3. YuKassa staging keys в `.env.staging` (реальные, не placeholder)
4. Offline parity — issues/documents queue UI
5. Registry v3 — promote GA, delete wip routes
