# W78 — интеграции без платежей (2026-07-20)

Связки: **offline-очередь ↔ inbox ↔ nextAction**, **недельный дайджест ↔ insights главной**, **dashboard.pending_acceptances fallback**.

## Что сделано

### 1. Offline → inbox / hero
- `offlineInbox.ts`: строка «Отправить N офлайн» / «Разобрать офлайн-очередь».
- `inboxSyncStore` подмешивает статус `getOfflineOutboxStatus` в те же items, что оплаты/приёмка.
- `buildProjectOsSnapshot`: blocked offline → hero; pending → после основных очередей.
- `UnifiedInboxScreen`: `OfflineSyncStatus` + tap по offline-строке → `flushOfflineOutbox`.

### 2. Digest → home
- `digestHomeInsight.ts`: CTA если в weekly есть приёмка / гарантия / замечания.
- `OsHomeScreen` мержит preview дайджеста в `osInsights`.

### 3. Dashboard fallback
- `pendingAcceptance || dash.pending_acceptances` — один источник очереди приёмки.

## Тесты
- `offlineInbox.w78.test.ts`
- `digestHomeInsight.w78.test.ts`

## Вне скоупа
H0 secrets, live YuKassa, CI workflow OAuth.
