# W93 — интеграции без live-оплат (2026-07-20)

Канон **всех** online-flush путей через `flushOfflineOutbox` + notify при изменении очереди.

## Архитектура

```
enqueue / removeJob  → notifyOfflineFlush          (баннер/статус сразу)
NetInfo online       → flushOfflineOutbox (_layout)
session boot         → flushOfflineOutbox (RenovaContext)
manual Sync          → flushOfflineOutbox (banner/conflicts/status)
                         ├─ notifyOfflineFlush
                         └─ synced>0 → notifyProjectDataChanged (W92)
```

Сырой `flush` из `@/lib/offlineQueue` — **только** внутри `flushOfflineOutbox`.

| Изменение | Зачем |
|-----------|--------|
| `_layout` online | после сети — UI golden path обновляется |
| RenovaContext boot | очередь догоняет при старте сессии |
| enqueue/removeJob | баннер «N в очереди» без remount |
| checklist-templates | reload по bus |
| subscription Pro | reload по bus |

## Тест

```bash
npx tsx apps/mobile/lib/offline/sync.w93.test.ts
```

## Вне скоупа

H0 live secrets / TestFlight.
