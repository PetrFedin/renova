# W72 — интеграции без платежей (2026-07-20)

Связки golden path: **acceptance → plan pin**, **schedule ACL**, **offline queue**, **portal/QC warranty**.

## Что сделано

### 1. Acceptance → метка на плане
- `accept_orchestrator.mark_acceptance_pin_on_plan` вызывается **внутри** `finalize_work_acceptance` (тот же commit).
- Комнаты этапа читаются из `stage.room_ids_json` (+ `WorkAcceptance.room_id` fallback).
- Пин комнаты получает label `✓ {stage.name}`; если пина нет — создаётся.

### 2. Schedule ACL
- Backend: `can_manage_schedule` — `contractor_id` / `owner` / `foreman`; `member`/`viewer` — нет.
- Mobile: `UnifiedScheduleView.canManageSchedulePlan` — UI-guard на создание/submit плана.

### 3. Offline queue
- `escalateIssue`, `createWarrantyClaim`, `closeWarrantyClaim` — enqueue при offline.

### 4. Portal / QC
- Portal: `contractor_company_name`, чистые типы, scope-строка по правам.
- QC: CTA «Гарантийный тикет» → `createWarrantyClaim`.

## Тесты
- `backend/tests/test_w72_integrations.py`

## Вне скоупа (ops / secrets)
- Kontur live, HTTPS `PUBLIC_BASE_URL`, YuKassa, CI workflow push (нужен `workflow` OAuth scope).
