# SMS / OTP Integrity — 2026-07-30

## Исправленные дефекты

Прежний SMS/OTP-контур мог вернуть `ok=true` без Twilio, включить текст SMS в demo-ответ, сохранить код и списать rate limit до подтверждения провайдера, а при отказе Redis молча перейти на память процесса.

Это создавало следующие риски:

- ложное сообщение «код отправлен»;
- недоступный пользователю, но действующий OTP;
- потеря OTP между API-инстансами;
- двойная SMS при конкурентном нажатии;
- разные пользователи для форматов `8…`, `7…`, `+7…`;
- plaintext OTP в Redis / process memory;
- возможность включить demo auth endpoint production override-флагом.

## Новый контракт

### Телефон

Все auth-запросы используют одну E.164-style идентичность. Российские локальные форматы приводятся к `+7XXXXXXXXXX`. Международный номер принимается только с явным `+`.

### SMS provider

- development/test без Twilio — явный preview, не delivery;
- staging/production без полной Twilio-конфигурации не стартуют;
- Twilio HTTP success недостаточен: ответ обязан содержать message SID и не содержать provider error;
- timeout, HTTP error, invalid JSON и rejected response становятся `SmsDeliveryFailed`;
- текст SMS не возвращается из service.

### OTP store

- staging/production требуют `REDIS_URL`;
- Redis установлен как базовая backend dependency;
- startup проверяет фактическую доступность Redis;
- runtime Redis failure возвращает OTP HTTP 503 и не падает необработанным 500;
- рабочая среда никогда не переходит на process memory.

### OTP transaction

1. Отправка сериализуется локальным lock и Redis distributed claim.
2. Предыдущий OTP сохраняется как rollback snapshot.
3. Новый OTP хранится только как HMAC-SHA256 от `phone:code`.
4. Rate-limit reservation создаётся до обращения к провайдеру.
5. При provider failure новый OTP и reservation откатываются, предыдущий OTP восстанавливается.
6. При подтверждённой delivery или local preview новый OTP остаётся активным.
7. OTP одноразовый и сравнивается constant-time.

### API semantics

- invalid phone / invalid code — HTTP 400;
- resend / lock — HTTP 429;
- Redis or SMS provider unavailable — HTTP 503;
- demo endpoints следуют environment policy и не могут быть включены production override-флагом.

## Регрессионные тесты

- `backend/tests/test_sms_otp_integrity.py`
- `backend/tests/test_otp_redis_runtime_integrity.py`

Покрыты phone normalization, Twilio preview/success/errors, HMAC storage, single-use verification, rollback, concurrent double-tap, Redis startup/runtime failure, HTTP mapping, production config and demo policy.
