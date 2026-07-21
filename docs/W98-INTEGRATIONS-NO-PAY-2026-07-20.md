# W98 — интеграции без live-оплат (2026-07-20)

Связи **задача из чата → календарь/home**, превью недели, план объекта, архив активности, admin health.

## Архитектура

```
taskFromChatMessage → syncProjectSideEffects
  → WeekScheduleStrip / Works / Inbox (bus)

design/floor upload → sync
  → PlanTabOverview.useProjectDataReload

golden-path mutate → bus
  → activity.tsx reload selected project
  → admin-dashboard health/stats
```

| Поверхность | Связь |
|-------------|--------|
| ChatThreadView | sync после задачи из чата |
| ChatTaskSheet | reload members бригады по bus |
| WeekScheduleStrip | календарь недели на Home |
| PlanTabOverview | счётчики план/дизайн |
| activity | объект архива после мутаций |
| admin-dashboard | stats/YuKassa/H0 health |

## Зачем

Создали задачу из сообщения — на главной «План на неделю» сразу показывает событие.
Загрузили дизайн — обзор вкладки «План» обновляет чипы без remount.

## Тест

```bash
npx tsx apps/mobile/lib/useProjectDataReload.w98.test.ts
```

## Вне скоупа

H0 live secrets / TestFlight / articles-admin.
