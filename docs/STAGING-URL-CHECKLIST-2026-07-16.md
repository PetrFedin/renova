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
