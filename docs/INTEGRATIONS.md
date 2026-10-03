# Renova: подключение внешних сервисов (пошагово)

Цель документа: у владельца есть ключи и идентификаторы, он вписывает их в окружение и получает работающую интеграцию **без правки кода**. Каждый раздел отвечает на четыре вопроса: что получить, что вписать, как проверить, что должно стать зелёным.

Правило честности: пока ключей нет, интеграция работает как заглушка и честно показывает статус `stub` или `partial`. Зелёный статус в репозитории означает «конфигурация полная». Он не доказывает, что провайдер реально отвечает: живую проверку вы делаете сами по строке «Проверка» в каждом разделе, а результат записываете в `docs/production-readiness-evidence.json`.

## 0. Как всё устроено

| Что | Где |
|---|---|
| Реестр интеграций (ключи, заглушки, правила production) | `backend/app/services/integrations/registry.py` |
| Статус для админа | `GET /api/v1/admin/integrations/status` |
| Сводка из терминала | `scripts/integrations-status.py` |
| Шаблон окружения production | `backend/.env.production.example` |
| Мобильная конфигурация | `apps/mobile/app.config.js` (поверх `app.json`), `apps/mobile/eas.json` |
| Подстановка реквизитов в `eas.json` | `scripts/apply-release-env.mjs` |

Где хранить значения. Бэкенд: секрет-менеджер вашего хостинга (переменные окружения процессов `renova-api` и `renova-worker`, оба из одного образа, значения одинаковые). Мобильное приложение: EAS secrets/переменные (`eas env:create` или раздел Environment variables в проекте на expo.dev) и секреты GitHub Actions для workflow `eas-build.yml`. Значения в репозиторий не коммитьте.

### 0.1. Как читать статус

Откройте `GET https://<API_HOST>/api/v1/admin/integrations/status` с Bearer-токеном администратора (id администратора должен быть в `ADMIN_USER_IDS`). В ответе по каждой интеграции:

- `state`: `configured` (все обязательные ключи на месте), `stub` (провайдер не выбран, работает заглушка), `partial` (часть ключей задана, часть нет), `external_only` (на бэкенде настраивать нечего, нужны внешние действия, например push);
- `missing_keys`: имена переменных, которых не хватает (значения не возвращаются никогда);
- `last_check` и `previous_check`: время и итог конфигурационной проверки;
- `live_verified`: всегда `false`, живые вызовы провайдеров статус не делает;
- `manual_prerequisites` и `smoke`: что сделать руками и чем подтвердить.

Из терминала: `RENOVA_API_URL=https://<API_HOST> RENOVA_ADMIN_TOKEN=<токен> python3 scripts/integrations-status.py`. Код выхода 1, если критичная интеграция не `configured`. Свой список: `--require payments,storage,sms_otp`.

### 0.2. Что блокирует старт в production

| Условие | Поведение |
|---|---|
| Нет S3 (`S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET`) | Старт отклоняется (C9). В staging предупреждение |
| В `CORS_ALLOWED_ORIGINS` есть `*` | Старт отклоняется в staging и production (C10) |
| Не задан `FORWARDED_ALLOW_IPS` | Старт отклоняется в production, предупреждение в staging (C11). Значение `*` допустимо, но с предупреждением |
| Нет Twilio, Sentry, OTLP, Redis, `ADMIN_USER_IDS` | Старт отклоняется (прежние guard-ы) |
| Нет ЮKassa | Предупреждение, оплата отвечает 503. Чтобы сделать отказом старта, задайте `INTEGRATIONS_STRICT=true` |

Рекомендация: включите `INTEGRATIONS_STRICT=true` в день запуска, когда E2 закрыт.

---

## 1. Платежи: ЮKassa

**Получить у провайдера**
1. Заключите договор с ЮKassa и создайте магазин в личном кабинете yookassa.ru.
2. В разделе «Интеграция» → «Ключи API» выпустите секретный ключ. Запишите `shopId` и секретный ключ.
3. Для начала возьмите **тестовый** магазин (отдельные тестовые shopId и ключ), боевой подключайте позже.
4. Придумайте длинную случайную строку для `YOOKASSA_WEBHOOK_SECRET` (`openssl rand -hex 24`). Бэкенд требует её в заголовке `X-Webhook-Secret` входящего webhook. ЮKassa произвольные заголовки не шлёт, поэтому заголовок должен добавлять ваш входящий прокси/балансировщик для пути `/api/v1/subscription/webhook`. Настройте это на стороне хостинга и проверьте тестовым платежом: без заголовка webhook получит 401, платёж останется в `processing` (см. APIB-037 в аудите). В production дополнительно проверяется IP отправителя из списка ЮKassa, поэтому `FORWARDED_ALLOW_IPS` обязателен.

**Вписать (бэкенд, оба процесса)**
```
YOOKASSA_SHOP_ID=<shopId>
YOOKASSA_SECRET=<секретный ключ>
YOOKASSA_WEBHOOK_SECRET=<ваша строка>
PUBLIC_BASE_URL=https://api.<ваш-домен>
FORWARDED_ALLOW_IPS=<адреса вашего балансировщика>
```

**Зарегистрировать webhook** в кабинете ЮKassa («Интеграция» → «HTTP-уведомления»): URL `https://<API_HOST>/api/v1/subscription/webhook`, события `payment.succeeded`, `payment.canceled`, `refund.succeeded`.

**Проверка**
1. `integrations-status.py`: `payments` → `configured`, `missing=-`.
2. Тестовый платёж из приложения на тестовой карте ЮKassa; статус платежа в приложении становится «оплачено», webhook приходит со статусом 200.
3. Тестовый возврат; приходит `refund.succeeded`.
4. Результат запишите в evidence (E2).

**Должно стать зелёным:** `payments.state=configured`; в логе API нет `YOOKASSA_...missing`; checkout больше не отвечает 503.

---

## 2. НПД: «Мой налог» и ФНС

В репозитории есть три независимые части.

**2.1. Статус плательщика НПД** (`statusnpd.nalog.ru`) публичный и ключей не требует. Отдельно настраивать нечего.

**2.2. OAuth «Мой налог» (`npd_moy_nalog`)**

Получить: у ФНС реквизиты OAuth-клиента: `client_id`, `client_secret`, разрешённый redirect URI, URL выдачи токена (`token_url`), подтверждение контракта обновления токена. Без этого интеграция остаётся выключенной (привязка отвечает 501).

Вписать:
```
MOY_NALOG_ENABLED=true
MOY_NALOG_CLIENT_ID=<client_id>
MOY_NALOG_CLIENT_SECRET=<client_secret>
MOY_NALOG_REDIRECT_URI=https://<API_HOST>/api/v1/fns/moy-nalog/oauth/callback
MOY_NALOG_AUTHORIZE_URL=https://lknpd.nalog.ru/api/v1/auth/login
MOY_NALOG_TOKEN_URL=<token_url от ФНС>
MOY_NALOG_TOKEN_ENCRYPTION_KEYS=<ключ1[,старый ключ]>
```
Ключ шифрования токенов: `openssl rand -hex 32`; он **обязан отличаться** от `SECRET_KEY`, минимум 32 байта; при ротации новый ключ ставится первым, старый остаётся следом до перешифровки.

Проверка: `npd_moy_nalog` → `configured`; `python -m app.core.runtime_preflight` проходит; на тестовом налогоплательщике проходит OAuth-колбэк и в профиле появляется привязка. Должно стать зелёным: статус `configured`, привязка отвечает 200, а не 501.

**2.3. Проверка чеков ФНС (`fns_receipts`)**: вписать `FNS_RECEIPT_LOGIN` и `FNS_RECEIPT_PASSWORD` (учётная запись, выданная ФНС для проверки чеков). Проверка: реальный чек через приложение возвращает статус от ФНС. Подробности: `docs/FNS-INTEGRATION-RU.md`.

---

## 3. SMS / OTP: Twilio

Получить: аккаунт Twilio, Account SID, Auth Token, номер или Messaging Service-отправитель, **подтверждённая доставка на российские номера** (проверьте требования к имени/номеру отправителя для РФ у Twilio до запуска).

Вписать (обязательно в production, иначе старта нет):
```
TWILIO_SID=<Account SID>
TWILIO_TOKEN=<Auth Token>
TWILIO_FROM=<номер отправителя в формате +...>
REDIS_URL=rediss://...   # общий OTP-store, тоже обязателен
```

Проверка: `sms_otp` → `configured`; вход в приложении по реальному российскому номеру, код приходит и принимается; повторный запрос кода упирается в ограничение, а не рассылается бесконечно. Должно стать зелёным: `sms_otp.configured`, сервис стартует в production.

---

## 4. Push: Expo Push → APNs и FCM

Бэкенду ключи не нужны (`external_only`): сервер шлёт через Expo Push API. Нужно настроить сторону приложения.

1. Создайте проект EAS: в каталоге `apps/mobile` выполните `eas init` под аккаунтом владельца. Получите `projectId` (UUID) и имя аккаунта (owner).
2. iOS: в Apple Developer создайте APNs-ключ; загрузите его через `eas credentials` для bundle id приложения.
3. Android: создайте проект Firebase, получите ключ сервис-аккаунта FCM V1; загрузите через `eas credentials`.
4. Вписать при сборке (EAS secrets): `RENOVA_EAS_PROJECT_ID`, `RENOVA_EAS_OWNER`.

Проверка: установите сборку на устройство, войдите, пошлите событие, которое создаёт уведомление; push приходит, а `push_receipt_worker` фиксирует квитанцию. Должно стать зелёным: `projectId` не пустой в собранном приложении (`releaseConfigGaps` пуст), push доходит.

---

## 5. E-sign: Контур.Сайн

Решите, входит ли внешняя подпись в релиз (E13). Без решения остаётся внутренняя подпись `in_app` (статус `stub`, это честно). Госключ **не реализован**, `GOSKEY_MODE` держите `off`.

Получить: API-ключ Контур.Сайн (сначала песочница), URL API.

Вписать:
```
KONTUR_MODE=sandbox        # потом live
KONTUR_API_KEY=<ключ>
KONTUR_API_URL=https://api.kontur.ru/sign/v1   # по документации провайдера
ESIGN_WEBHOOK_SECRET=<не короче 16 символов>
```
Webhook: в кабинете Контура укажите `https://<API_HOST>/api/v1/esign/webhooks/kontur` и тот же секрет. Подробности: `docs/STAGING-KONTUR.md`.

Проверка: `esign` → `configured`; документ уходит на подпись, webhook возвращает статус. Должно стать зелёным: провайдер `kontur`, `missing=-`.

---

## 6. Хранилище: S3 / MinIO (обязательно в production)

Получить: бакет (Yandex Object Storage, VK Cloud, AWS S3, MinIO), ключ доступа и секрет с правами чтения/записи именно на этот бакет. Бакет приватный; доступ к файлам идёт по подписанным ссылкам.

Вписать:
```
S3_ENDPOINT=https://<endpoint провайдера>
S3_ACCESS_KEY=<access key>
S3_SECRET_KEY=<секретный ключ из панели провайдера>
S3_BUCKET=renova
S3_PUBLIC_URL=<внешний URL для ссылок, если отличается от S3_ENDPOINT>
```
Если задана часть ключей, старт откажет (частичная конфигурация опаснее пустой).

Проверка: `storage` → `configured`; `python -m app.core.runtime_preflight` (шаг `storage_runtime` достаёт бакет); загрузка документа и фото в приложении; объект виден в бакете; подписанная ссылка открывается с телефона. Должно стать зелёным: провайдер `s3`, а не `local_disk`.

---

## 7. Email: SMTP

Нужен для аварийных оповещений (`OPS_ALERT_EMAIL`); пока SMTP нет, письма только пишутся в лог (`stub`, `log_only`).

Вписать:
```
SMTP_HOST=<сервер>
SMTP_PORT=587
SMTP_USER=<логин>
SMTP_PASSWORD=<пароль>
SMTP_FROM=<адрес отправителя>
SMTP_USE_TLS=true
OPS_ALERT_EMAIL=<адрес дежурного>
```
Если задан `OPS_ALERT_EMAIL`, `SMTP_HOST` обязателен в production. Проверка: `email` → `configured`, тестовое письмо дежурному доходит (вызовите оповещение ops-алерта на staging).

---

## 8. Sentry и OTLP (обязательны в production)

**Sentry:** создайте проект типа FastAPI/Python, возьмите DSN, вписать `SENTRY_DSN`. **OTLP:** разверните или арендуйте коллектор (gRPC), вписать `OTEL_EXPORTER_OTLP_ENDPOINT=https://<коллектор>:4317`, `OTEL_EXPORTER_OTLP_INSECURE=false`, `LOG_JSON=true`. Адрес не может быть localhost.

Проверка: `sentry` и `otlp` → `configured`; тестовая ошибка видна в Sentry и доходит дежурному (E8); в коллекторе видны трассы сервиса `OTEL_SERVICE_NAME`. Должно стать зелёным: оба статуса `configured`, алерт подтверждён человеком.

---

## 9. Мобильное приложение: идентификаторы и сборка

Конфигурация собирается из `apps/mobile/app.json` (версия, номера сборки, иконки) и `apps/mobile/app.config.js` (значения из окружения). Заглушки в коде содержат слово `PLACEHOLDER` и не выдаются за настоящие.

| Переменная | Что это | Где взять |
|---|---|---|
| `RENOVA_IOS_BUNDLE_ID` | bundle id iOS (по умолчанию `ru.renova.app` из `app.json`) | App Store Connect → Identifiers |
| `RENOVA_ANDROID_PACKAGE` | package Android, **публикуется навсегда** | ваше решение (C2), например `ru.renova.app` |
| `RENOVA_EAS_OWNER` | аккаунт Expo | expo.dev |
| `RENOVA_EAS_PROJECT_ID` | UUID проекта EAS | `eas init` |
| `RENOVA_API_URL_STAGING`, `RENOVA_API_URL_PRODUCTION` | адреса API | ваш хостинг (E6) |
| `RENOVA_EXPORT_COMPLIANCE_EXEMPT` | `true`, если используется только стандартный HTTPS (тогда `ITSAppUsesNonExemptEncryption=false`); не задано = ключ не пишется (C5, решение владельца) | юридическое решение владельца |
| `RENOVA_ASC_APP_ID`, `RENOVA_APPLE_TEAM_ID` | для `eas submit` iOS | App Store Connect → App Information; Apple Developer → Membership |
| `RENOVA_GOOGLE_SERVICE_ACCOUNT_KEY_PATH` | ключ сервис-аккаунта Google Play | Play Console → API access |

Шаги:
1. Занесите значения в EAS environment variables (для `RENOVA_*`, читаемых `app.config.js`) и в окружение CI.
2. Перед сборкой в CI/локально выполните `node scripts/apply-release-env.mjs` — она впишет адреса API и поля submit в `eas.json` (рабочая копия). Проверка: `node scripts/apply-release-env.mjs --check` (код 1, пока остались `PLACEHOLDER`).
3. Профили `production` и `testflight` **не соберутся**, пока остаются незаполненные значения (`app.config.js` падает с перечнем, какие именно). Обход только для отладки: `RENOVA_ALLOW_PLACEHOLDER_CONFIG=1`.
4. Камера: плагин `expo-camera` и разрешение `CAMERA` добавлены; `RECORD_AUDIO` заблокирован. После `eas build` проверьте итоговый Android-манифест (C6).
5. Проверка итоговой конфигурации: `cd apps/mobile && npx expo config --json --type public` — в `extra.releaseConfigGaps` должен быть пустой список.
6. `npm run testflight:preflight` проходит.

Должно стать зелёным: `releaseConfigGaps=[]`, preflight PASS, сборка `production` стартует и ставится на устройство.

---

## 10. Итоговая проверка перед запуском

1. `python3 scripts/integrations-status.py` на реальной среде: все критичные `configured`.
2. `python -m app.core.runtime_preflight` OK, `scripts/release-smoke.py` (read) зелёный, workflow `External staging release` зелёный (`docs/RELEASE-RUNBOOK.md`).
3. Живые проверки из разделов 1–8 выполнены, результаты и ссылки записаны в evidence.
4. Включён `INTEGRATIONS_STRICT=true`.
