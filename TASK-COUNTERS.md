# Task Counters — единый источник истины

## Проблема (до)

Независимые механизмы:

| Поверхность | Источник | Баг |
|-------------|----------|-----|
| Dock Calendar | `useTodayTaskCount` → calendar API + `toISOString().slice(0,10)` (UTC) | «Сегодня» ломалось вечером UTC+3; done WO могли попадать в count |
| Inbox tasks | `inboxTaskBadge(items)` — число **строк** UI | Не синхрон с calendar |
| Overdue | размыто в inbox rows | Нет отдельного сигнала на dock |
| Home badge | тот же `todayTasks`, если calendar убран из dock | Семантика badge «переезжала» без объяснения |

## Inventory типов задач (`byType`)

| Тип | Что считаем |
|-----|-------------|
| `calendar` / **dueToday** | Открытые work orders, чей плановый интервал пересекает **локальный сегодня** (TZ пользователя) |
| `overdue` | Открытые WO с `planned_end < local today` |
| `upcoming` | Открытые WO со стартом в ближайшие 7 локальных дней |
| `acceptance` | Ожидающие приёмки |
| `selection` | Подборы в статусе proposed |
| `payment` | Pending / paid_unverified оплаты |
| `change_order` / `approval` | Согласования ДО |
| `warranty` | Гарантийные |
| `quality` | Замечания (QC), видимость по роли |
| `schedule` | График на согласовании (submitted) |
| `document` | Черновики документов (роль customer/owner) |

## Определения

```ts
type TaskCounters = {
  dueToday: number;
  overdue: number;
  upcoming: number;
  actionRequired: number; // число ненулевых action-категорий (+ overdue flag), как inbox-row
  byType: Record<TaskType, number>;
  revision: string | number;
  asOfDate?: string;
  timezone?: string;
};
```

- **Задача на сегодня (`dueToday`)**: открытый WO, пересекающий локальную дату пользователя.
- **actionRequired**: не сумма единиц, а число категорий с `>0` (+ overdue как отдельная категория) — семантика строк inbox.
- **Calendar badge** = только `dueToday`.
- **Inbox tasks / amber** = только `actionRequired`.
- **Overdue** = отдельная точка на calendar, не смешивать с dueToday и не переносить на home.

## Backend

`GET /api/v1/tasks/counters?project=&role=&timezone=&status=`

- `timezone` — IANA (по умолчанию `Europe/Moscow`); `asOfDate` считается через `ZoneInfo`, не TZ сервера.
- После mutation WO: WS `task.updated` `{ task_id, revision, counter_delta, project_id }` в inbox-канал.

## Frontend

- `taskCountersStore` — snapshot + revision; delta если `revision` новее, иначе reconcile fetch.
- `useTodayTaskCount` → `{ count: dueToday, overdue, reliable }`.
- `useActionRequiredCount` → inbox / «Ещё».
- Смена project / role / timezone → новый `contextKey` и fetch.
- Offline flush / projectDataBus → reconcile.

## Тесты

```bash
npm run test:task-counters
```

Покрывает: delta/revision, stale, project/role/tz key, smoke wiring, запрет переноса badge на home.
