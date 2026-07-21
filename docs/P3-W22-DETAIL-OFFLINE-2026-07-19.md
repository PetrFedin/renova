# P3-W22 — detailLevel guides + acceptance offline UX

## Изменения

- **`ObjectTabGuide`** — `compact` из `detailLevel` (`brief` → однострочная подсказка); убран hardcoded `compact` на вкладках объекта
- **`WorkAcceptanceScreen`** — `OfflineSyncStatus` для исполнителя (очередь синка видна на экране приёмки)
- **`PaymentDetailSheet`** — «Перейти к приёмке» ведёт на `/work-acceptance` (customer) или `/quality-control` (contractor)
- **`detailLevelPolicy.test`** — проверки `objectTabGuideCompact`

## Следующее (P3-W23)

- YuKassa staging keys
- `npm run ci:push-workflow`
- Punch photo on plan tap
