# W95 — интеграции без live-оплат (2026-07-20)

Сквозные связи **смета CO ↔ заказчик**, **оплата этапа**, **план/punch**, **уведомления**.

## Архитектура

```
createChangeOrder (исполнитель) → syncProjectSideEffects
  → CustomerEstimateView.useProjectDataReload → orders + badge «Изменения»

confirmPayment / YuKassa return → sync
  → StageDetailPaymentBlock.useProjectDataReload → pending счёт этапа

punch / upload plan → sync
  → FloorPlanPanel.useProjectDataReload + QC inbox

notify / CO / accept → sync
  → NotificationCenter.useProjectDataReload
```

| Поверхность | Связь |
|-------------|--------|
| CustomerEstimateView | reload CO + lockDiff по bus |
| StageDetailPaymentBlock | reload payments по bus |
| FloorPlanPanel | reload plans + sync после upload |
| NotificationCenter | reload списка по bus |
| DocumentsHub OCR | sync после классификации |

## Зачем

Исполнитель создал доп. работы — у заказчика на смете сразу badge без смены вкладки.
Оплатили этап — блок «Оплатить» на карточке этапа исчезает/обновляется.
Punch на плане виден на всех вкладках объекта.

## Тест

```bash
npx tsx apps/mobile/lib/useProjectDataReload.w95.test.ts
```

## Вне скоупа

H0 live secrets / TestFlight / Kontur live.
