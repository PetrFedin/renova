# Kontur eSign — staging / production checklist (2026-07-17)

## Env

```env
KONTUR_MODE=sandbox   # или live
KONTUR_API_KEY=...
KONTUR_API_URL=https://api.kontur.ru/sign/v1
PUBLIC_BASE_URL=https://api.your-domain.ru
ESIGN_WEBHOOK_SECRET=...   # X-Esign-Secret header
```

## Webhook URL (регистрация в Kontur)

```
POST {PUBLIC_BASE_URL}/api/v1/esign/webhooks/kontur
Header: X-Esign-Secret: {ESIGN_WEBHOOK_SECRET}
Body: { "external_id": "...", "status": "signed" }
```

## Probe

```bash
curl -H "X-User-Id: <customer-id>" http://127.0.0.1:8100/api/v1/esign/health
```

Ответ: `webhook_kontur`, `kontur_mode`, `kontur_configured`.

## Dev simulate (без Kontur)

```
POST /api/v1/esign/dev/kontur/simulate
{ "external_id": "kontur-sandbox-...", "status": "signed" }
```
