# W84 — интеграции без live-оплат (2026-07-20)

Hub согласований, этапы, работы, дизайн/мусор, расходы → `syncProjectSideEffects`.

## Канон

`apps/mobile/lib/projectDataBus.ts` + вызовы из UI / `RenovaContext`.

## Где подключено

| Зона | Мутации |
|------|---------|
| `app/approvals.tsx` | approve / reject hub |
| `RenovaContext` | submitStage / acceptStage / rejectStage |
| StageDetailHero | startStage |
| StageDetailAcceptanceFold | checklist toggle / add |
| WorkOrderDetailScreen | transitionWorkOrder |
| CreateWorkSheet | createWorkOrder |
| DesignPackageList | create / submit / approve |
| WasteOrderList | create / request / approve / complete |
| ManualExpenseForm / ExpenseDetailSheet | add / patch / delete расход |

## Зачем

После решения в «Согласованиях» или сдачи этапа inbox и nextAction на главной обновляются сразу — без ухода с экрана и remount.

## Тест

`npx tsx apps/mobile/lib/projectDataBus.w83.test.ts`

## Вне скоупа

H0 secrets / TestFlight / live YuKassa.
