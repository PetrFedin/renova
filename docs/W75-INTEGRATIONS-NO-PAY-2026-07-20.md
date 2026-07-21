# W75 — интеграции без платежей (2026-07-20)

Связки: **офлайн-приёмка UI**, **ДО → график**, **дайджест ↔ гарантия/приёмка**, **eSign → document_status**, **портал pending drafts**.

## Что сделано

### 1. Приёмка offline
- `OfflineSyncStatus` фильтр `pathIncludes=['/work-acceptances']` + label «Приёмка».
- Badge «Ждут решения» на экране приёмки.
- Подписи offline-задач: запрос/решение/возврат приёмки, гарантия, эскалация.

### 2. Change Order → план-график
- `approve_with_sign_draft` синхронизирует активный work schedule с этапами.
- API: `schedule_synced` в approve (hub + change-orders).

### 3. Дайджест
- `weekly_report`: `warranty_open`, `warranty_overdue`, `pending_acceptances`.
- Rule-based digest текст упоминает гарантию и очередь приёмки.
- Fix: reload проекта после `budget_summary` (ORM expire / greenlet).

### 4. eSign webhook
- Ответ: `document_id` + `document_status` (+ signed_at).
- Портал: `pending_draft_documents` без уже подписанных (есть signed_at).

## Тесты
`backend/tests/test_w75_integrations.py` — 4 кейса.

## Вне скоупа
H0 HTTPS/YuKassa/Kontur live secrets, CI workflow OAuth, полный TS→0.
