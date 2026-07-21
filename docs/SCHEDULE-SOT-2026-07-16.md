# Schedule Source of Truth — 2026-07-16

**Статус:** принято (P1.3 minimal)

## Канон

| Слой | Таблица / сервис | Роль |
|------|------------------|------|
| **SoT (план-график)** | `project_work_schedules` + `project_work_schedule_items` | Единственный источник согласованных дат, статусов пунктов графика, задержек |
| **API** | `project_work_schedule_service.py`, `backend/app/api/v1/project_work_schedule.py` | CRUD графика, submit/confirm |
| **OS summary (KPI)** | `schedule_service.build_schedule_summary` | Агрегат по `stages` — прогноз, просрочки; **не** дублирует редактирование графика |
| **Calendar (view)** | `calendar_service.build_calendar` | Производная лента событий (этапы, оплаты, waste) для UI календаря |

## Правила

1. **Создание/изменение сроков** — только через Work Schedule API (`/projects/{id}/work-schedules`).
2. **Календарь** — read-only derived view; не писать обратно в `stages.planned_*` из calendar UI.
3. **Mobile `WorkScheduleScreen`** — показывает прогресс **графика**, не статус **приёмки** (канон приёмки: `work-acceptances`).
4. **OS `/os/schedule`** — KPI-сводка для dashboard; при расхождении приоритет у `project_work_schedules`.

## Файлы

- `backend/app/models/work_schedule.py`
- `backend/app/services/project_work_schedule_service.py`
- `backend/app/services/schedule_service.py` — KPI view
- `backend/app/services/calendar_service.py` — calendar derived view
- `apps/mobile/components/screens/WorkScheduleScreen.tsx`
- `apps/mobile/lib/api/workSchedule.ts`

## Acceptance (P1.3)

- [x] Документ SoT
- [x] Docstring в `calendar_service` / `schedule_service`
- [x] Label в WorkScheduleScreen: график ≠ приёмка
