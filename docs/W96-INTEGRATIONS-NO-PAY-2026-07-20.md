# W96 — интеграции без live-оплат (2026-07-20)

Расширение `useProjectDataReload` на вторичные golden-path поверхности:
мусор, лиды, дизайн, гости, подборы, комната, график-обзор, уведомления.

## Архитектура

Мутация → `syncProjectSideEffects` → bus → локальный reload без remount.

| Поверхность | Данные |
|-------------|--------|
| WasteOrderList | вывоз мусора |
| JobLeadsBoard | заявки / КП |
| DesignPackageList | дизайн-пакеты |
| ViewerSharePanel | гости (viewer) |
| MaterialPickList | подборы (если не override) |
| RoomDetailScreen | комната + чеки/расходы/picks |
| PlanSchedulePanel | обзор плана этапов |
| NotificationsList | лента уведомлений (профиль) |

## Зачем

Согласовали вывоз / дизайн / гостя на одном экране — соседние вкладки
и карточка комнаты показывают актуальное состояние сразу.

## Тест

```bash
npx tsx apps/mobile/lib/useProjectDataReload.w96.test.ts
```

## Вне скоупа

H0 live secrets / TestFlight / admin articles.
