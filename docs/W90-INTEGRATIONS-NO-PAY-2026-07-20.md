# W90 — интеграции без live-оплат (2026-07-20)

Расширение `useProjectDataReload` на основные list-экраны golden path.

## Архитектура

После мутации (`syncProjectSideEffects` → `notifyProjectDataChanged`) локальные списки
обновляются **без focus/remount**:

| Экран | reload |
|-------|--------|
| QualityControlScreen | load |
| OsMaterialsScreen | reload |
| OsSelectionsScreen | reload |
| UnifiedScheduleView | reload |
| StageDetailScreen | reload (useCallback) |
| ManagerDashboardScreen | load |
| approvals hub | load (useCallback) |

Уже было (W89): ControlView ×2, WorkAcceptanceScreen.

## Зачем

Приняли этап на одном экране — QC / Контроль / Материалы / Согласования / График
сразу показывают актуальное состояние. Иначе пользователь думал, что «не сработало».

## Тест

```bash
npx tsx apps/mobile/lib/useProjectDataReload.w89.test.ts
```

## Вне скоупа

H0 live secrets / TestFlight / articles-admin.
