# W99 — интеграции без live-оплат (2026-07-20)

Связи **ICS-импорт → график**, **CSV сметы**, **массовые чеки**, **FAB «+» работа**.

## Архитектура

```
importIcal → syncProjectSideEffects → WeekScheduleStrip / UnifiedSchedule / Home
importEstimateCsv → loadProject + sync → смета/бюджет/inbox
patchReceipt (bulk) → sync → аналитика/расходы
CreateWorkSheet (FAB) → sync (уже в sheet) + sync в onCreated → работы
```

| Поверхность | Связь |
|-------------|--------|
| IcalImportButton | sync после ICS |
| ScheduleIconToolbar | sync после ICS |
| EstimateDocumentsLayer | loadProject + sync после CSV |
| ReceiptBulkCategoryPanel | sync после категорий |
| ReceiptBulkLinkPanel | sync после привязки к этапу |
| OsQuickFab | sync после создания работы |

## Зачем

Импортировали календарь подрядчика — «План на неделю» и этапы сразу актуальны.
Массово привязали чеки к этапу — бюджет/аналитика без remount.

## Тест

```bash
npx tsx apps/mobile/lib/projectDataBus.w99.test.ts
```

## Вне скоупа

H0 live secrets / TestFlight / articles-admin.
