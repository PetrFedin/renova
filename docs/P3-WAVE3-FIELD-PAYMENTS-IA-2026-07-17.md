# P3 Wave 3 — Field, Payments, IA

**Дата:** 2026-07-17  
**Ветка:** `develop`  
**Связь:** `docs/RENOVA-COMPETITIVE-GAP-PLAN-2026-07-17.md` (P3.1b, P3.2a/c, P3.3a, P3.4)

## Сделано

### A. P3.2c — CO approve → budget line
- `budget_service.apply_change_order_to_budget()` — строка «Доп. работы» с маркером `[co:{id}]`, идемпотентно
- `change_order_service.approve()` — budget line + `project.budget_planned += amount`
- `budget_summary()` — `total_plan = max(line_total, project.budget_planned)` для корректного hub после CO
- Тест: `backend/tests/test_change_order_budget.py`
- Mobile: `EstimateChangesLayer` уже вызывает `onProjectReload()` после approve

### B. P3.3a — Punch photo on tap
- `FloorPlanPanel.tsx` — tap в punch mode → камера → `photo_key` → `createIssue`
- Backend: `issue_service.create_issue(photo_key=…)` + колонка `project_issues.photo_key`
- Verified: flow redirect → `/quality-control` + Alert

### C. P3.4 — IA cleanup
- `/control` tab → redirect `/quality-control` (legacyRoutes, control.tsx, pushLinks)
- `finance-center` — `visibility: 'hidden'` в routeRegistry (redirect route сохранён)
- `/work-schedule` → calendar (уже было; WorkScheduleScreen returnTo → `/calendar`)

### D. P3.1b — YuKassa webhook idempotency
- `yookassa_service.process_webhook()` — `duplicate: True` если payment не pending
- Тест: `test_webhook_duplicate_does_not_double_confirm` (+ существующий idempotent test)

### E. P3.2a — Portal accept stage (partial)
- `portal_token_service` — scopes: `read`, `accept_stage`
- `POST /projects/{id}/portal-link` — заказчик, опция `allow_accept_stage`
- `POST /portal/projects/{id}/work-acceptances/{id}/accept` — magic token + scope
- `portal.tsx` — кнопка «Принять этап» при pending + write scope
- Snapshot: `pending_acceptances`, `can_accept_stage`

## Verify

```bash
cd backend && .venv/bin/python -m pytest tests/test_project_lifecycle.py tests/test_yookassa_project_payment.py tests/test_change_order_budget.py -q
npm run test:priority
```

## Backlog (следующая волна)

| ID | Задача | Effort |
|----|--------|--------|
| P3.2a+ | Portal sign act + pay pending | L |
| P3.1 | YuKassa staging E2E с live keys | M |
| P3.1 | Kontur webhook → signed_at | M |
| P3.4e | Home unified action queue | M |
| P3.5 | Registry v3 — delete wip routes | S |
| P4 | Offline: documents, issues queue UI | L |
