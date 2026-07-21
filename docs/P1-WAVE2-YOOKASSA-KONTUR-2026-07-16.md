# P1 Wave 2 — ЮKassa + Kontur (2026-07-16)

## P1.1 ЮKassa — project payments

### Backend
- `Payment.yookassa_payment_id` + migration `q1r2s3t4u5v6`
- `POST /api/v1/projects/{project_id}/payments/{payment_id}/yookassa-checkout`
  - только **customer**, gate приёмки этапа
  - `return_url`: `renova://payment-return?projectId=&paymentId=`
  - **demo** (development/test без ключей): instant confirm через `process_webhook`
- `POST /api/v1/subscription/webhook` → единый `yookassa_service.process_webhook`
  - `metadata.kind=project_payment` | `pro_subscription`

### Mobile
- `paymentsApi.checkoutYookassa`
- `PaymentDetailSheet` — кнопка «Оплатить картой (ЮKassa)»
- `app/payment-return.tsx` — deep link после redirect

### Env
```env
YOOKASSA_SHOP_ID=
YOOKASSA_SECRET=
YOOKASSA_WEBHOOK_SECRET=   # optional header X-Webhook-Secret
```

### Tests
- `backend/tests/test_yookassa_project_payment.py`

## P1.2 Kontur — sandbox HTTP scaffold

- `KonturESignProvider._submit_http` — POST `{KONTUR_API_URL}/signatures` (best-effort)
- `POST /api/v1/esign/dev/kontur/simulate` — **development/test only**, завершить pending подпись

### Env
```env
KONTUR_MODE=sandbox|live|off
KONTUR_API_KEY=
KONTUR_API_URL=https://…   # sandbox endpoint
```

## Verify
```bash
cd backend && .venv/bin/python -m pytest tests/test_yookassa_project_payment.py -q
npm run test:priority   # из корня renova
```

## Next
- Staging URL в `eas.json` + TestFlight preflight
- Kontur live webhook completion
- Procurement hub UI (P1.7)
