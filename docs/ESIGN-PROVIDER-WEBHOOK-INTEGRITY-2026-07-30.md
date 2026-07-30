# External E-sign Provider / Webhook Integrity — 2026-07-30

## Исправленные дефекты

Прежний e-sign контур содержал несколько ложных состояний:

- webhook без `status` по умолчанию завершал подпись как `signed`;
- любое неизвестное состояние со словом `sign` могло стать `signed`;
- Контур после timeout/HTTP error создавал локальную pending-подпись с external ID, которого провайдер не принимал;
- sandbox fallback придумывал signing URL;
- Госключ-scaffold показывался доступным при одном client ID и создавал фиктивный pending;
- повторный callback мог откатить signed в failed либо resurrect failed в signed;
- double-tap создавал разные provider idempotency keys;
- один provider external ID мог случайно выбрать одну из нескольких legacy-записей.

## Новый provider contract

### Контур

- provider доступен только при активном mode, API key, API URL и webhook secret;
- pending создаётся только после HTTP 2xx, валидного JSON и явного accepted/pending статуса;
- rejected/failed/unknown/malformed response не создаёт подпись;
- timeout/network/HTTP error возвращает failed, без локального pending;
- signing URL принимается только по HTTPS;
- idempotency key детерминирован по document/version/signer/role/content hash;
- одинаковая заявка при конкурентном double-tap имеет одну provider identity.

### Госключ

Текущий scaffold всегда `unavailable`. Любой `GOSKEY_MODE=sandbox|live` блокирует startup, пока не реализованы реальная отправка, callback authentication и provider status contract.

## Webhook contract

- внешний callback всегда требует `X-Esign-Secret`;
- сравнение secret выполняется constant-time;
- provider должен быть включён;
- external ID и status обязательны;
- поддерживаются только явные status sets: pending / signed / failed;
- malformed nested payload возвращает 400, не 500;
- неизвестный статус возвращает 400;
- неизвестная подпись возвращает 404;
- несколько подписей с одним provider external ID возвращают 409;
- side effects выполняются только при первом pending → signed;
- повторный signed callback идемпотентен.

## Monotonic signature lifecycle

Допустимы только:

- pending → pending;
- pending → signed;
- pending → failed;
- signed → signed (duplicate);
- failed → failed (duplicate).

`signed → failed` и `failed → signed` запрещены как `signature_final_state_conflict`.

## Document binding

- внешняя подпись невозможна без checksum текущей версии;
- pending provider result обязан иметь external ID;
- существующая pending/signed заявка signer/version/provider переиспользуется;
- подписывается именно текущая `DocumentVersion` и её content hash.

## Startup guard

До приёма трафика проверяются:

- допустимый provider mode;
- Kontur API key;
- HTTPS API URL в staging/production;
- webhook secret длиной не менее 16 безопасных символов;
- запрет включения Госключ-scaffold.

## Регрессии

- `backend/tests/test_esign_provider_webhook_integrity.py`
- `backend/tests/test_esign_idempotency_key.py`

Оба набора должны входить в обязательный backend CI gate.
