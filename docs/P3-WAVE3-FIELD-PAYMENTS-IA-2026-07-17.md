# P3-WAVE3 — Field, payments, IA (2026-07-17)

**Ветка:** `develop`  
**Основание:** `RENOVA-COMPETITIVE-GAP-PLAN-2026-07-17.md`

## Закрыто в этой волне

| ID | Задача | Файлы | DoD |
|----|--------|-------|-----|
| P3.1c | SBP clipboard | `PaymentDetailSheet.tsx`, `expo-clipboard` | Кнопка «Скопировать сумму» + подсказка открыть банк |
| P3.1b | YuKassa webhook idempotency | `yookassa_service.py`, `test_yookassa_project_payment.py` | Повторный webhook → `duplicate: true`, один PaymentApproved |
| P3.2c | CO → budget line | `change_order_service.py`, `budget_service.apply_change_order_to_budget`, `test_co_budget_line.py` | Approve CO → `budget_planned` + строка works `[co:id]` |
| P3.3a | Punch photo on tap | `FloorPlanPanel.tsx` | Камера при tap в punch mode → `photo_key` на issue → QC |
| P3.4 | Control deprecated | `legacyRoutes.ts` | `/control` → `/quality-control` (customer + contractor) |
| P3.4 | finance-center | `routeRegistry.ts`, `finance-center.tsx` | `visibility: hidden`, redirect → budget › payments |
| P3.4 | Schedule hub | `work-schedule.tsx`, `WorkScheduleSummaryCard` | Redirect → `/calendar` |

## Тесты

```bash
cd backend && .venv/bin/python -m pytest tests/test_co_budget_line.py tests/test_yookassa_project_payment.py tests/test_project_lifecycle.py -q
```

## Следующий backlog (P3-W4+)

1. **Portal v2** — accept stage + sign act + pay pending (magic link write)
2. **YuKassa staging keys** — `eas.json`, `.env.staging`, no auto-demo in staging
3. **Kontur live webhook** — `signed_at` from sandbox/production
4. **CO → eSign act** — документ на доп. работы после approve
5. **Offline parity** — issues/documents queue UI (`offlineUi.ts`)
6. **Registry v3** — promote GA, delete wip routes (analytics, reports)
