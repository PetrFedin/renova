# P3-W45 — Budget SoT + bank statement confirm

## Budget planned (единый writer)

`sync_project_budget_planned` = Σ estimate lines + Σ approved change orders.

- CO approve: BudgetLine + sync (без `budget_planned +=`)
- `estimate.recalc_budget` → sync
- `budget_summary` / os budget: sync + commit, без `max(lines, project)`

## Bank import → confirm

- `POST …/import/bank-statement` — match (как было)
- `POST …/import/bank-statement/confirm` — confirm pending matches (gate приёмки)
- DocumentsHub: после матча CTA «Подтвердить»

## Tests

- `test_budget_sot_w45.py`
- `test_bank_confirm_w45.py`

## Остаётся (ops / W46)

- YuKassa staging keys (не код)
- Schedule submit/confirm UI
- Closeout / warranty close UI
