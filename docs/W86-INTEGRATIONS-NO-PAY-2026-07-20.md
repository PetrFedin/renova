# W86 — интеграции без live-оплат (2026-07-20)

Закупки, план/замечания, заявки, бригада, SLA, уведомления → `syncProjectSideEffects`.

## Канон

Тот же helper: `apps/mobile/lib/projectDataBus.ts`.

## Где подключено

| Зона | Мутации |
|------|---------|
| purchase/[id] | updatePurchaseStatus |
| OsMaterialsScreen | updatePurchaseStatus |
| MaterialPickDetailSheet | cancel purchase |
| FloorPlanPanel | createIssue (punch) |
| ReworkSlaWidget | extendReworkSla |
| JobLeadsBoard | create / quote / autoAssign |
| team-qr | joinTeam |
| RoomDetailScreen | updateRoom / archive |
| WorkOrderDetailPanel | patch notes |
| NotificationCenter | read / markAll / snooze |

## Зачем

Статус закупки и замечание с плана меняют material/quality в inbox; без sync «Входящие» и nextAction отставали. Уведомления синхронизируют бейджи после прочтения.

## Тест

`npx tsx apps/mobile/lib/projectDataBus.w85.test.ts`

## Вне скоупа

H0 live secrets / TestFlight.
