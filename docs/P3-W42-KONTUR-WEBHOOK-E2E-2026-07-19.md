# P3-W42 — Kontur webhook E2E · poll fix · signing_url

## Сделано

| Task | Изменение |
|------|-----------|
| Poll bugfix | API `provider` alias + `esignPoll` matches `provider_name` |
| Webhook payload | Renova + Kontur-like `{object.id,status}` |
| Staging secret | `ESIGN_WEBHOOK_SECRET` обязателен при kontur sandbox/live |
| Side effects | signed → doc `active`, activity, notify |
| signing_url | sign response + open in WebBrowser |
| Health | esign в release-health + enriched `/esign/health` |

## DoD
- Pending kontur signature → webhook → `signed_at` + poll returns `signed`
- Staging без webhook secret → 503 на webhook
- Document Center открывает `signing_url` если есть

## Ops
1. `KONTUR_MODE=sandbox` + `KONTUR_API_KEY` + `ESIGN_WEBHOOK_SECRET`
2. Webhook URL из `GET /api/v1/esign/health`
3. Dev: `POST /api/v1/esign/dev/kontur/simulate`

## Не в этом PR
- Реальный кабинет Kontur credentials в git
- Полный OAuth «Мой налог»
