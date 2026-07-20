# W89 — интеграции без live-оплат (2026-07-20)

Экран **Контроль / Приёмка** ↔ `projectDataBus` + типы API под реальный payload.

## Архитектура

Новый helper: `useProjectDataReload(reload)` — экраны с локальным state
(не только home/inbox) перечитываются после `syncProjectSideEffects`.

```
WorkAcceptanceScreen / ControlView
  └─ useProjectDataReload(load)
         └─ subscribeProjectDataChanged → load()
```

## Что сделано

| Зона | Изменение |
|------|-----------|
| CustomerControlView | closeIssue → sync; reload по bus |
| ContractorControlView | closeIssue → sync; reload по bus |
| WorkAcceptanceScreen | reload по bus |
| WorkAcceptance type | `checklist_progress?` optional (как в API) |
| acceptancePending | уже defensive (9977cf7) |

## Зачем

После краша на `.done`: список приёмки на Контроле должен обновляться, когда заказчик принял этап в другом экране — без ухода с вкладки и remount. Закрытие замечания сразу чистит inbox/home.

## Тест

```bash
npx tsx apps/mobile/lib/domain/acceptancePending.test.ts
npx tsx apps/mobile/lib/useProjectDataReload.w89.test.ts
```

## Вне скоупа

H0 live secrets / TestFlight / articles-admin.
