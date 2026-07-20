# W91 — интеграции без live-оплат (2026-07-20)

Расширение `useProjectDataReload` на hub «Работы», комнаты, чаты, аналитику и связанные панели.

## Архитектура

Мутация → `syncProjectSideEffects` → `notifyProjectDataChanged` → локальный reload
без focus/remount (табы Expo Router часто остаются mounted).

| Поверхность | reload |
|-------------|--------|
| OsWorksScreen | loadProject + blockedMap + SLA |
| WorkOrderDetailScreen | getWorkOrder |
| WorkOrdersListPanel | listWorkOrders |
| ScratchpadScreen | listScratchpad |
| ActivityFeed | activityFeed |
| DecisionHistoryPanel | activity → decisions |
| ChatListView | listChats / inbox store |
| ProjectAnalyticsPanel | receipts/expenses/budget/KPI |
| StageExpensePanel | stage expenses |
| OsRoomsScreen (customer/contractor) | rooms + change requests |

Уже было: W89 control/acceptance, W90 QC/materials/schedule/stage/approvals.

## Зачем

Сменили этап/WO/чат/комнату на одном табе — соседний таб «Работы», лента,
аналитика и чаты показывают актуальные данные. Иначе UI выглядел «сломанным».

## Тест

```bash
npx tsx apps/mobile/lib/useProjectDataReload.w91.test.ts
```

## Вне скоупа

H0 live secrets / TestFlight / articles-admin.
