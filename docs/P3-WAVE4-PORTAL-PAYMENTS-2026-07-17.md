# P3-WAVE4 — Portal accept + payments guard (2026-07-17)

**Ветка:** `develop`

## Закрыто

| ID | Задача | Изменения |
|----|--------|-----------|
| P3.2a | Portal accept stage | `portal.py` scopes `accept_stage`, POST accept, `portal.tsx` кнопка «Принять этап» |
| P3.2a | Customer portal link | POST `/projects/{id}/portal-link` с `allow_accept_stage` |
| P3.1b | Webhook duplicate guard | `test_webhook_duplicate_does_not_double_confirm` |
| P3.4 | Control → QC | `legacyRoutes.ts`, control tab screens |
| P3.4 | Schedule registry | `work-schedule` redirect metadata в `routeRegistry.ts` |
| P3.1a | Staging scaffold | `eas.json` staging URL placeholder (keys — в `.env.staging`) |

## API

- `POST /api/v1/portal/session` — scopes в ответе
- `POST /api/v1/portal/projects/{id}/accept/{acceptance_id}` — token + accept_stage scope
- Mobile: `api.portalAcceptStage`, `api.createCustomerPortalLink`

## Тесты

```bash
cd backend && .venv/bin/python -m pytest tests/test_co_budget_line.py tests/test_change_order_budget.py tests/test_yookassa_project_payment.py -q
npm run test:priority
```

## Следующий backlog (P3-W5)

1. Portal v2 pay pending — YuKassa checkout из magic link
2. CO → eSign act (draft document on approve)
3. Kontur live webhook + idempotency audit
4. Offline UI pattern (`offlineUi.ts`) на приёмке и issues
5. Registry v3 — удалить wip routes
