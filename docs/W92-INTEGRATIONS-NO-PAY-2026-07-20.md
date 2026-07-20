# W92 — интеграции без live-оплат (2026-07-20)

Мост **offline flush → projectDataBus** + reload на detail/отчётах/чате/хабе.

## Архитектура

```
мутация (online)  → syncProjectSideEffects → notifyProjectDataChanged
offline flush     → flushOfflineOutbox
                      ├─ notifyOfflineFlush     (очередь / inbox W79)
                      └─ synced>0 → notifyProjectDataChanged  (W92)
```

Канон sync UI: только `flushOfflineOutbox` (не сырой `flush` из баннера/конфликтов).

| Поверхность | Связь |
|-------------|--------|
| flushOfflineOutbox | → projectDataBus при synced>0 |
| OfflineSyncBanner | flushOfflineOutbox + subscribeOfflineFlush |
| OfflineSyncStatus | subscribeOfflineFlush |
| conflicts | flushOfflineOutbox + subscribeOfflineFlush |
| purchase/[id], material/[id] | useProjectDataReload |
| ChatThreadView | useProjectDataReload(loadMessages) |
| StageDependenciesPanel | useProjectDataReload |
| OsRepairHubScreen | badges acceptance/selections |
| reports | useProjectDataReload |

## Зачем

1. Офлайн-правки после Sync сразу видны на Работах / Материалах / Приёмке.
2. Detail закупки/материала и тред чата не «застывают», пока открыты.
3. Бейджи хаба «Ремонт» обновляются без смены вкладки.

## Тест

```bash
npx tsx apps/mobile/lib/offline/sync.w92.test.ts
npx tsx apps/mobile/lib/useProjectDataReload.w92.test.ts
```

## Вне скоупа

H0 live secrets / TestFlight.
