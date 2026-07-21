# W85 — интеграции без live-оплат (2026-07-20)

Клиентский **портал** и deep-link поверхности → `syncProjectSideEffects`.

## Канон

`refreshPortalSnapshot` в `app/portal.tsx` всегда:
1. обновляет snapshot портала
2. вызывает `syncProjectSideEffects` (inbox/home в приложении)

## Где подключено

| Зона | Мутации |
|------|---------|
| Portal | schedule confirm/reject, accept/return stage, YuKassa demo, sign in_app/Kontur, AppState resume |
| material/[id] | approve/submit pick, cancel purchase |
| ScheduleDayDetail | продлить срок / transition WO |
| OsWorksScreen | createStage |
| ReceiptList | reverify / patch чек |
| ViewerSharePanel | share / remove guest |
| StageDetailLinks | patchStageRooms |
| createProjectChat | createChat |

## Зачем

Решения по magic-link (график, приёмка, подпись, demo-оплата) больше не оставляют stale nextAction в основном приложении, если пользователь параллельно в Renova.

## Тест

`npx tsx apps/mobile/lib/projectDataBus.w84.test.ts`

## Вне скоупа

H0 live secrets / TestFlight.
