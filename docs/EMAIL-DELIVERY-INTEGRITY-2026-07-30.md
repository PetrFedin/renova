# Email Delivery Integrity — 2026-07-30

## Исправленная проблема

Старый `email_stub.send_email()` при отсутствии SMTP или после реального SMTP exception записывал письмо в лог и возвращал управление без ошибки. Automation worker после этого устанавливал `_ops_alert_sent_for_streak = True`.

В результате система могла одновременно:

- не отправить аварийное письмо;
- отобразить сообщение `queued` / считать alert завершённым;
- прекратить повторные попытки для текущей серии сбоев;
- записать содержимое служебного письма в application log.

## Новый контракт

### Development / test

Если SMTP не настроен:

- письмо не считается отправленным;
- `send_email()` возвращает `False`;
- в лог попадают только recipient, subject и длина body;
- automation metrics получают статус `preview`;
- streak не помечается отправленным.

### Staging / production

- `OPS_ALERT_EMAIL` требует настроенный `SMTP_HOST`;
- рабочий SMTP требует `SMTP_FROM` либо email-формат `SMTP_USER`;
- `SMTP_USER` без `SMTP_PASSWORD` запрещён;
- некорректные email/header/port блокируются до приёма трафика;
- отсутствие SMTP или delivery failure не деградирует в log-only success.

### SMTP delivery

`True` возвращается только после успешного `SMTP.send_message()` без refused recipients.

Отдельно различаются:

- `EmailConfigurationError` — неправильная конфигурация или header;
- `EmailDeliveryFailed` — timeout, network, TLS, auth, provider refusal.

### Automation worker

Worker публикует в health metrics:

- `ops_alert_last_status`: `not_configured | preview | failed | sent`;
- `ops_alert_last_at`;
- `ops_alert_last_error`.

`_ops_alert_sent_for_streak` устанавливается только для `sent`. Preview и failure остаются retryable.

## Совместимость

`app.services.email_stub` оставлен только как реэкспорт нового `email_service`, чтобы старые call sites автоматически получили fail-closed семантику. Новому коду следует импортировать `app.services.email_service`.

## Регрессионные проверки

`backend/tests/test_email_delivery_integrity.py` проверяет:

- local preview без ложного success;
- отсутствие утечки body в лог;
- production fail-closed;
- SMTP acceptance;
- network failure;
- TLS/login;
- refused recipient;
- header injection;
- startup policy;
- development warning;
- worker preview/failure/success state machine;
- wiring настроек в FastAPI startup.

Тест включён в обязательный backend CI gate.
