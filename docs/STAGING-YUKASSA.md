# YuKassa staging — чеклист

## Env (backend)

```bash
YOOKASSA_SHOP_ID=...
YOOKASSA_SECRET_KEY=...
PUBLIC_BASE_URL=https://your-staging-api.example.com
ENVIRONMENT=staging
```

## Проверка

1. `POST /api/v1/projects/{id}/payments/{pid}/checkout-yookassa` — не `demo: true`
2. Webhook `POST /api/integrations/payments/yukassa/webhook` — idempotent confirm
3. Mobile: `renova://payment-return` после оплаты в браузере

## Локально без keys

Demo mode (`pay.demo`) — только development. В staging `ALLOW_DEMO_PAYMENTS=false` (см. `environment.py` guards).

## Связанные файлы

- `backend/app/services/yookassa_service.py`
- `apps/mobile/components/renova/PaymentDetailSheet.tsx`
- `docs/P3-W17-CI-PLAYWRIGHT-2026-07-18.md`
