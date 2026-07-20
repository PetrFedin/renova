# W73 — интеграции без платежей (2026-07-20)

Связки: **warranty post-closeout + SLA**, **импорт сметы ГрандСмета/;**, **матрица ACL бригады**.

## Что сделано

### 1. Warranty после сдачи объекта
- Создание гарантии на `is_archived` объекте разрешено (post-closeout режим).
- SLA **14 дней** → `due_at` на issue; ответ API: `post_closeout`, `sla_days`, `due_at`.
- Список: `overdue`, `post_closeout_allowed`.
- Closeout checklist: `warranty_overdue`, `post_closeout`, next_action «Гарантийный режим…».
- UI: DocumentsHub / QC показывают post-closeout и SLA.

### 2. Импорт сметы (Excel / ГрандСмета)
- Авто-разделитель `,` / `;` / tab.
- RU-заголовки: Наименование, Ед. изм., Количество, Цена / Сумма (цена = сумма/кол-во).
- Mobile: подсказка в EstimateDocumentsLayer + delimiter в ответе.

### 3. ACL бригады
- `team_service.require_capability`: `field_write` | `escalate` | `schedule` | `estimate_lock`.
- Issues create → `field_write` (member+; viewer нет).
- Escalate → только customer / owner / foreman (member → 403).

## Тесты
`backend/tests/test_w73_integrations.py` — 3 кейса.

## Вне скоупа
Kontur live, HTTPS staging, YuKassa, CI workflow OAuth.
