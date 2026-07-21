# P3-W46 — Schedule agreement UI + warranty close + closeout

## Schedule

- Mobile `UnifiedScheduleView`: create → submit (contractor) → confirm/reject (customer)
- Backend: `ScheduleSubmitted` / `ScheduleConfirmed` / `ScheduleRejected` + notify
- Confirm: `sync_stages_from_schedule_items` (даты items → stages)

## Warranty

- QC close на `[Гарантия]` → `closeWarrantyClaim` (архив warranty doc)

## Closeout lite

- `GET …/closeout-checklist`, `POST …/closeout` → `is_archived`
- DocumentsHub: «Завершение объекта»

## Tests

`test_schedule_closeout_w46.py` — 2 passed
