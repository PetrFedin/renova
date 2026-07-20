# W81 — интеграции без платежей (2026-07-20)

Связки: **смена объекта → inbox**, **график submit/confirm/reject → home nextAction + inbox**.

## Что сделано

### 1. Смена объекта
- `loadProject` после успеха вызывает `reloadInboxSync` + `notifyProjectDataChanged`.
- `useInboxTasks` перезагружается при смене `projectId` (не ждёт blur вкладки).

### 2. График ↔ главная / входящие
- После отправки / согласования / отклонения work-schedule:
  - inbox убирает «Подтвердить график»;
  - home обновляет `workScheduleStatus` через `subscribeProjectDataChanged` → `load()`.

### 3. Bus
- `projectDataBus.ts` — лёгкая шина без циклов import.

## Тест
`projectDataBus.w81.test.ts`

## Вне скоупа
H0 secrets, live YuKassa.
