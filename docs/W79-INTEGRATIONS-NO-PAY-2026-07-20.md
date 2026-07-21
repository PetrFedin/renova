# W79 — интеграции без платежей (2026-07-20)

Связки: **flush offline → inbox/home**, **closeout-checklist → nextAction/inbox**.

## Что сделано

### 1. Offline flush bus
- `notifyOfflineFlush` после каждого `flushOfflineOutbox`.
- `useInboxTasks` подписан → пересборка inbox (offline-строка исчезает после sync).
- `OfflineSyncStatus` после кнопки «Синхронизировать» вызывает `reloadInboxSync`.
- `OsHomeScreen` обновляет счётчики offline без полного reload проекта.

### 2. Closeout checklist
- `closeoutHome.ts` — строки inbox «Завершить объект» / блокеры.
- `buildInboxItems` тянет checklist, когда все этапы done.
- `buildProjectOsSnapshot` при `isComplete` берёт title/subtitle из checklist (тот же SoT, что DocumentsHub).
- Home грузит `closeoutChecklist` в hints.

## Тесты
- `closeoutHome.w79.test.ts`, `flushBus.w79.test.ts`

## Вне скоупа
H0 secrets, live YuKassa, CI workflow OAuth.
