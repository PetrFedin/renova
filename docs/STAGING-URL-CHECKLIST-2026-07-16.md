# Staging URL checklist — перед EAS build

**Без реальных секретов.** Замените placeholder перед TestFlight/staging.

## 1. `apps/mobile/eas.json`

Профили `preview`, `testflight`, `production` содержат:

```json
"EXPO_PUBLIC_API_URL": "https://api-staging.example.com"
```

**Действие:** заменить на реальный staging API (HTTPS), например `https://api-staging.renova.example`.

`development` профиль использует `http://127.0.0.1:8100` — только локальная разработка.

## 2. Backend staging

- [ ] `DATABASE_URL` — PostgreSQL (не SQLite)
- [ ] `PUBLIC_BASE_URL` — совпадает с mobile `EXPO_PUBLIC_API_URL`
- [ ] `SECRET_KEY` — уникальный для staging
- [ ] `ALLOW_DEMO_SEED=0` / `environment=staging`
- [ ] CORS / health: `GET /health` → 200


## 4. ЮKassa (staging — без demo)

- [ ] `YUKASSA_SHOP_ID` и `YUKASSA_SECRET_KEY` — **обязательны** в staging (demo instant pay отключён)
- [ ] `YUKASSA_WEBHOOK_SECRET` — для верификации webhook
- [ ] Webhook URL: `https://<staging-api>/api/v1/payments/yookassa/webhook`
- [ ] Mobile `eas.json` профиль `staging` / `preview`: `EXPO_PUBLIC_API_URL` = HTTPS staging API
- [ ] Smoke: `pytest tests/test_yookassa_project_payment.py::test_demo_not_allowed_in_staging -q`

## 3. Smoke перед build

```bash
cd backend && .venv/bin/python -m pytest tests/test_acceptance_canon.py -q
curl -s "$STAGING_URL/health"
npm run test:priority
```

## 4. EAS

```bash
cd apps/mobile
eas build --profile testflight --platform ios
```

## 5. После build

- [ ] Login demo отключён (`EXPO_PUBLIC_DEMO=0`)
- [ ] Deep links: payment return, notifications
- [ ] Push (если включён) → staging FCM keys
