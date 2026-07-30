# FNS Receipt Verification Integrity — 2026-07-30

## Исправленные дефекты

Прежний фискальный контур мог считать чек подтверждённым без ответа ФНС:

- development/test автоматически возвращал `verified=true` в demo-режиме;
- HTTP 200 принимался без проверки JSON и без доказательства чека в payload;
- transient provider errors не отличались от окончательной невалидности;
- `demo_verified` мог сохраняться как `fns_verified=true` и попадать в финансовый факт;
- state mapper не сохранял точные `pending / failed / invalid` состояния;
- legacy demo-чек мог оставлять связанный Expense в `confirmed`.

## Новый контракт

### QR

Для проверки обязательны:

- `t` — дата/время;
- `s` — положительная сумма;
- `fn` — номер фискального накопителя;
- `i`/`fd` — номер фискального документа;
- `fp` — фискальный признак.

Некорректная или отрицательная сумма и повреждённая дата блокируются до provider request.

### Provider verification

`verified_live` выдаётся только если одновременно выполнены условия:

1. настроены FNS credentials;
2. provider вернул HTTP 200;
3. response является непустым JSON object;
4. payload содержит receipt/ticket/document evidence;
5. provider не вернул error;
6. если в payload есть сумма, она совпадает с QR как рубли либо целые копейки.

HTTP и transport mapping:

- `400/404/422` → `invalid`;
- `401/403` → `verification_failed`;
- `408/425/429/5xx`, timeout/network → `verification_pending`;
- malformed/empty 200 → `verification_failed`.

### Truth flags

Только `verification_status=verified_live` вместе с `fns_verified=true` означает:

- `verified=true`;
- `accepted=true`;
- `valid=true`.

`saved_unverified`, `verification_pending`, `verification_failed`, `invalid` и legacy `demo_verified` никогда не являются подтверждённым фискальным доказательством.

### Demo removal

- автоматический demo-success удалён;
- health всегда возвращает `demo_verify_allowed=false`;
- compatibility stub возвращает только `saved_unverified`;
- новый код не создаёт `demo_verified`.

### Legacy repair

`repair_legacy_receipt_truth()` идемпотентно:

- переводит `demo_verified` в `saved_unverified`;
- снимает `fns_verified`;
- переводит связанные `confirmed` расходы в `pending_receipt`;
- не изменяет dispute/refund/deleted evidence.

ORM safety events дополнительно запрещают загружать или сохранять non-live статус с `fns_verified=true`.

## Regression gates

- `backend/tests/test_fns_receipt_verification_integrity.py`;
- `backend/conftest.py` и compatibility `backend/tests/conftest.py` блокируют возврат demo-success и `res.data`;
- `.github/workflows/fns-receipt-integrity.yml` запускает полный FNS fault-injection набор при каждом релевантном push/PR.
