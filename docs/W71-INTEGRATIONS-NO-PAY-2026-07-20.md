# W71 — интеграции без оплат (связи в архитектуре)

**Дата:** 2026-07-20 · `develop`  
**Scope:** топ-20 без ЮKassa / portal pay — связать то, что уже было разрознено.

## Закрыто в этой волне (код)

| # | Связь | Где |
|---|--------|-----|
| 2 / 14 | **Approvals hub CO → budget + черновик на подпись** | `approvals.py` → `change_order_service.approve_with_sign_draft` |
| 2 / 14 | ДО в сводке бюджета | `budget_summary.change_orders*` → `BudgetSummarySection` |
| 12 | **Импорт сметы CSV** | `estimate/import-csv` + `EstimateDocumentsLayer` |
| 5 | Hub «Сроки» канон | `OsCalendarScreen` → `UnifiedScheduleView` (redirect work-schedule уже был) |
| 1 | eSign webhook path | уже `esign/webhooks/kontur` — нужен секрет на staging |
| 3 | Portal sign/accept | уже в `portal.tsx` + scopes |
| 15–18 | 1С / bank / digest / warranty | уже в `DocumentsHub` + `export.py` |

## Уже было в продукте (не дублировать)

- Punch + фото на плане (`FloorPlanPanel`)
- Offline UI на приёмке (`WorkAcceptanceScreen` + `OfflineSyncStatus`)
- Guest menu filter (`routeRegistry` READ_ONLY_MORE_IDS)
- Warranty claims API + DocumentsHub
- Bank CSV import, weekly digest, 1C export honesty/real endpoints

## Осталось (секреты / следующая волна)

1. Kontur **live** credentials + `ESIGN_WEBHOOK_SECRET`
2. HTTPS `PUBLIC_BASE_URL` staging (portal magic-link)
3. Углубление offline issues queue
4. Typecheck baseline ↓
5. Branded portal polish

## Проверка

```bash
cd backend && PYTHONPATH=. .venv/bin/python -m pytest tests/test_w71_integrations.py -q
```

Golden path без оплаты: **ДО в Approvals → бюджет растёт → черновик в Документах → in_app/Kontur sign → Сроки в calendar**.
