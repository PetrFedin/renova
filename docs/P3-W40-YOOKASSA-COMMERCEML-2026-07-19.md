# P3-W40 — YuKassa staging probe · CommerceML · release-health

## Сделано

| Task | Изменение |
|------|-----------|
| YuKassa health | `GET /api/v1/subscription/yookassa/health` — флаги без секретов |
| Startup warn | staging/production без `YOOKASSA_*` → warning в лог |
| Release health | `integrations`: yookassa / smtp / ollama / automation worker |
| CommerceML | `GET …/export/1c-commerceml.xml` + Document Center |
| Admin UI | Панель показывает статус ЮKassa / SMTP / worker |

## DoD
- Staging без ключей: health `configured=false`, `demo_allowed=false`, checkout 503
- Webhook URL в health = `{PUBLIC_BASE_URL}/api/v1/subscription/webhook`
- CommerceML: корень `КоммерческаяИнформация` ВерсияСхемы 2.04

## Ops checklist (staging)
1. `YOOKASSA_SHOP_ID` + `YOOKASSA_SECRET` (+ webhook secret)
2. В кабинете ЮKassa: webhook → `/api/v1/subscription/webhook`
3. `GET …/subscription/yookassa/health` → `live_checkout_ready: true`
4. Тестовый платёж + return `renova://payment-return`

## Не в этом PR
- Реальные ключи в git (только env)
- Полный bidirectional sync 1С
