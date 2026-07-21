# W94 — интеграции без live-оплат (2026-07-20)

Замыкание очереди offline и платёжных/документных поверхностей на buses.

## Архитектура

```
writeQueue / retryJob / dropJobsForProject → emitQueueChanged → notifyOfflineFlush
conflicts merge/dedupe                   → writeQueue (не сырой AsyncStorage)
payment-return (YuKassa)                 → syncProjectSideEffects
scan-receipt                             → syncProjectSideEffects
archive/trash lifecycle                  → notifyProjectDataChanged
DocumentsHub                             → useProjectDataReload(reloadIndex)
```

| Изменение | Зачем |
|-----------|--------|
| writeQueue/retry/drop → flushBus | баннер очереди всегда актуален |
| conflicts → writeQueue | merge не обходит канон |
| payment-return | бюджет/inbox после оплаты |
| scan-receipt | аналитика/расходы после чека |
| lifecycle | home после archive объекта |
| DocumentsHub | индекс PDF после golden-path |

## Тест

```bash
npx tsx apps/mobile/lib/offline/sync.w94.test.ts
```

## Вне скоупа

H0 live secrets / TestFlight / articles-admin.
