# W87 — интеграции без live-оплат (2026-07-20)

Смета/бюджет/онбординг + архитектурный helper `runWithProjectSideEffects`.

## Канон

`apps/mobile/lib/projectDataBus.ts`:

- `syncProjectSideEffects` — после мутации
- `runWithProjectSideEffects(opts, action)` — **предпочтительный** wrapper для новых callers

## Где подключено

| Зона | Мутации |
|------|---------|
| AddEstimateLineForm | addEstimateLine |
| ContractorEstimateView | patchEstimateLine, createChangeOrder |
| budget-planner / wizard confirm | patchProject budget |
| contractor-wizard | convertJobLead |
| ProjectEmptyState | createProjectFromTemplate |
| NotificationsList / SnoozeUntilPicker | read / snoozeUntil |
| FurnitureLayer | createFurniture |
| LeadChat | postLeadMessage |
| ContractorProfile | inviteTeam / createTeam |

## Зачем

Строки сметы и ДО меняют estimate/change_order в inbox; без sync заказчик не видел nextAction. Helper снижает риск пропустить sync в следующих волнах.

## Тест

`npx tsx apps/mobile/lib/projectDataBus.w87.test.ts`

## Вне скоупа

H0 live secrets / TestFlight.
