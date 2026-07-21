# Интеграция Renova с ФНС и «Мой налог»

## Уровни
- **L1 MVP:** POST statusnpd.nalog.ru — проверка самозанятого по ИНН
- **L2 MVP:** QR чека → proverkacheka.nalog.ru
- **L3 v1.1:** OAuth l knpd.nalog.ru — авто-чеки при приёмке этапа
- **L4 v2:** Официальный партнёр ФНС (SOAP, заявка на npd.nalog.ru)

## L1 API
POST https://statusnpd.nalog.ru/api/v1/tracker/taxpayer_status
Body: {"inn":"...", "requestDate":"YYYY-MM-DD"}

## Backend: app/services/fns/
- status_npd.py, receipt_verify.py, moy_nalog/client.py

## Dev bypass (без OAuth)

Кнопка «Включить флаг (без OAuth)» и `POST /api/v1/fns/moy-nalog/link` — **только** при `MY_NALOG_DEV_BYPASS_ENABLED=true` в development/test.

В staging/production bypass запрещён даже при ошибочно выставленном флаге (403 + audit `moy_nalog_bypass_denied`). Admin role bypass не открывает. Capability: `GET /api/v1/fns/health` → `moy_nalog.dev_bypass_available`.

