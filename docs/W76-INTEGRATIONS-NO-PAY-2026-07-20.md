# W76 — интеграции без платежей (2026-07-20)

Связки: **home nextAction ← очередь приёмки / ДО / подписи / гарантия**, **dashboard enrich** (те же счётчики на API).

## Что сделано

### 1. Mobile nextAction (единый снимок)
- `WorkScheduleHint` расширен: `warrantyOpen`, `warrantyOverdue`, `pendingChangeOrders`, `pendingSignDocs`.
- Приоритет после оплат: **WA pending** (даже без `stage.status=review`) → **ДО pending** → **черновики подписи** → график / смета / материалы.
- После сдачи: оплата → **гарантия** → подписи → общий closeout.
- Health при открытой гарантии: `attention`/`risk`, не «Завершён / good».

### 2. OsHomeScreen load
- `listWarrantyClaims`, `listChangeOrders`, `listProjectDocuments` (draft) в `Promise.allSettled`.
- Передаётся в `buildProjectOsSnapshot` вместе со статусом графика.

### 3. Backend dashboard
- `enrich_dashboard_actions`: `pending_acceptances`, `pending_change_orders`, `warranty_open|overdue`, `pending_sign_docs`.
- Уточняет `next_action_title/type` (accept_stage / change_order / warranty / sign_document).
- Поля зеркалят mobile — один контракт golden path.

## Тесты
- `apps/mobile/lib/domain/buildProjectOsSnapshot.w55.test.ts` — кейсы W76.
- `backend/tests/test_w76_integrations.py` — dashboard counters + CO + warranty.

## Вне скоупа
H0 HTTPS/YuKassa/Kontur live, CI workflow OAuth, полный TS→0, live платежи.
