# Staging: Kontur.Сайн (e-sign)

Чеклист перед включением подписи в staging/production.

## Env (backend)

```env
ENVIRONMENT=staging
PUBLIC_BASE_URL=https://api-staging.your-domain.ru
SECRET_KEY=<unique ≥16 chars>

KONTUR_MODE=sandbox   # off | sandbox | live
KONTUR_API_KEY=<key from Kontur cabinet>
KONTUR_API_URL=https://api.kontur.ru/sign/v1
```

## Проверки

1. **Policy guards** (локально или CI):
   ```bash
   npm run staging:smoke
   ```
   При `KONTUR_MODE=sandbox|live` без ключа — warning в логах startup.

2. **Live health** (staging API поднят):
   ```bash
   API_BASE=https://api-staging.your-domain.ru npm run staging:smoke
   ```
   Шаг 3 печатает `kontur_configured` и `kontur_mode` из `GET /api/v1/esign/health`.

3. **Mobile** — в «Документы» провайдер `kontur` в action sheet только если `available: true`.

## Webhook

- URL: `{PUBLIC_BASE_URL}/api/v1/esign/webhooks/kontur`
- Idempotency: повторный webhook не дублирует подпись (см. `test_kontur_webhook_idempotent`).

## Переход sandbox → live

1. Получить production API key в кабинете Kontur.
2. `KONTUR_MODE=live`, обновить `KONTUR_API_KEY`.
3. Перезапуск backend; `esign/health` → `kontur_configured: true`.
4. Smoke: подписать тестовый договор в demo-проекте, дождаться webhook или poll status.

## Откат

`KONTUR_MODE=off` — провайдер недоступен, in_app подпись остаётся.
