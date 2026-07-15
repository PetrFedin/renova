# TestFlight prep — runbook (Renova v0.2.0)

**Репозиторий:** https://github.com/PetrFedin/renova  
**Ветка:** `develop` (после merge `main` @ v0.2.0)  
**Цель:** воспроизводимый путь от git → EAS build → TestFlight без localhost API.

---

## 0. Что уже в репозитории

| Артефакт | Назначение |
|----------|------------|
| `apps/mobile/eas.json` | профили `testflight` / `preview` / `production` + `EXPO_PUBLIC_*` |
| `apps/mobile/app.json` | `version: 0.2.0`, `bundleIdentifier: ru.renova.app` |
| `apps/mobile/.env.example` | локальная разработка vs staging URL |
| `scripts/testflight-preflight.sh` | автоматические гейты перед билдом |
| `.github/workflows/eas-build.yml` | ручной `workflow_dispatch` (не на каждый push) |
| `docs/TESTFLIGHT-NOTES-v0.2.md` | текст для тестировщиков в App Store Connect |

---

## 1. Preflight (обязательно)

```bash
cd renova   # корень монорепо
npm run testflight:preflight
```

Проверяет:

- `npm run mobile:test`
- контракт `eas.json` (testflight ≠ localhost, `EXPO_PUBLIC_DEMO=0`)
- `app.json` version `0.2.x` + bundle id
- `npm run test:guards`

CI-вариант (без EAS token / без live API):

```bash
bash scripts/testflight-preflight.sh --ci
```

---

## 2. Staging API (обязательно для TestFlight)

Мобильный билд **не должен** ходить на `127.0.0.1`. В профиле `testflight`:

```json
"EXPO_PUBLIC_API_URL": "https://api-staging.example.com"
```

Замените на реальный staging URL **до** первого production-like билда:

1. Деплой API с `ENVIRONMENT=staging` (см. `backend/.env.staging.example`)
2. Postgres + `alembic upgrade head` (`docs/STAGING-POSTGRES-SMOKE.md`)
3. Обновите `eas.json` → `build.testflight.env.EXPO_PUBLIC_API_URL`
4. Коммит + push

Проверка API:

```bash
curl -sf https://YOUR-STAGING/health | jq .
# environment: staging
```

---

## 3. Expo / EAS — первичная настройка (один раз)

### 3.1 Аккаунт Expo

```bash
npm ci
cd apps/mobile
npx eas login
npx eas whoami
```

### 3.2 Привязка проекта

Если `extra.eas.projectId` ещё нет в `app.json`:

```bash
cd apps/mobile
npx eas init
# следуйте CLI — projectId попадёт в app.json / app.config
```

### 3.3 Apple credentials (TestFlight)

```bash
cd apps/mobile
npx eas credentials -p ios
```

Рекомендуется хранить сертификаты в EAS Credentials, не в git.

### 3.4 GitHub secret (опционально CI build)

В https://github.com/PetrFedin/renova/settings/secrets/actions :

| Secret | Значение |
|--------|----------|
| `EXPO_TOKEN` | Expo access token (https://expo.dev/settings/access-tokens) |

Без токена workflow `EAS Build & Submit` выполнит только **preflight** и выведет warning.

---

## 4. Локальный EAS build (TestFlight)

```bash
cd apps/mobile
# убедитесь что EXPO_PUBLIC_API_URL в eas.json указывает на staging
npx eas build --platform ios --profile testflight --non-interactive
```

После успеха:

```bash
npx eas submit --platform ios --profile testflight --latest --non-interactive
```

Или через GitHub Actions → **EAS Build & Submit** → inputs:

- profile: `testflight`
- platform: `ios`
- submit: `true` (если Apple creds настроены в EAS)

---

## 5. App Store Connect

1. Дождитесь обработки билда в TestFlight.
2. **What to Test** — скопируйте из `docs/TESTFLIGHT-NOTES-v0.2.md` (раздел RU).
3. Добавьте internal testers.
4. Чеклист тестировщика — тот же документ (приёмка, документы, офлайн, план/факт).

---

## 6. Troubleshooting

| Симптом | Действие |
|---------|----------|
| API «не доступен» в приложении | Проверить `EXPO_PUBLIC_API_URL` в билде (`eas build:inspect` / build logs) |
| `eas-build.yml` fail 0s | Был битый YAML — исправлено в wave TestFlight prep; перезапустите workflow |
| Submit fail | `eas credentials`, Apple Team ID, ASC app id |
| Document upload fail на device | iOS permissions: `NSPhotoLibraryUsageDescription`, `NSCameraUsageDescription` в `app.json` |
| Kontur 501 | Ожидаемо без `KONTUR_MODE=sandbox` на API |

---

## 7. Rollback

- TestFlight: предыдущий build в ASC → expire / не распространять.
- API: предыдущий Docker image / git tag `v0.2.0`.
- Миграции v0.2 обратно совместимы (nullable / server_default).

---

## 8. Следующий приоритет после TestFlight

1. Реальный Kontur/Goskey HTTP (`KONTUR_MODE=live`)
2. Production OCR engine
3. `poetry.lock` + alembic без pip sidecar

**Обновлено:** 2026-07-15 (wave TestFlight prep)
