# Контракт «факт бюджета» (UI ↔ API)

Документ для due diligence: как Renova считает **факт ремонта** на клиенте при отсутствии `backend/app/` в репозитории.

## Источники данных

| Поле / экран | Источник | Назначение |
|--------------|----------|------------|
| **Факт на сводке** | `GET …/os/budget` → `budget_spent` | Канонический server ledger |
| **Список «Расходы»** | `buildUnifiedBudgetExpenses()` | Client unified list без дублей |
| **Аналитика (категории, этажи)** | Те же `unifiedRows` | Investor-grade breakdown |
| **Оплаты подрядчикам** | `payments` (confirmed/pending) | **Не** входят в факт ремонта |

## Формула unified list (mobile)

```
unified = receipts
        + os_expenses (без дубля receipt_id / payment_id)
        + material_picks WHERE status = 'purchased'
          (только если нет Expense с purchase_id — W56)
```

**W56:** `Purchase` → `paid`/`delivered` создаёт `Expense(purchase_id)` на сервере;
`budget_spent` и mobile list сходятся. Не дублировать purchased picks, если уже есть purchase Expense.

**Не входят в факт:**

- `material_picks` со статусами `draft`, `pending`, `approved`, `rejected`
- Счета к оплате подрядчикам (`payments.pending`)
- План сметы (`budget_planned` / estimate)

## Сверка (reconcile)

При расхождении `|listTotal - budget_spent| > 1 ₽` UI показывает `BudgetFactReconcileBanner` (допуск 1 ₽).

Код: `apps/mobile/lib/domain/budgetFactReconcile.ts`

## Кто платил (ownership UI)

| Тип строки | Метка | В факте |
|------------|-------|---------|
| Чек / ручной receipt | Вы | Да |
| Os expense | Учёт | Да |
| Material purchased | Подрядчик | Да |

## E2E

`e2e/customer-path.spec.ts`: scan +500 → budget_spent ↑ → delete → rollback.

## Backend (server ledger)

Источник `budget_spent` на сервере: `backend/app/services/budget_service.py` → `refresh_budget_facts()`:

- синхронизация чеков → `Expense` (confirmed)
- подтверждённые оплаты → expense
- `budget_spent = sum(confirmed expenses)`

Mobile unified list строится из receipts + os_expenses + purchased picks и сверяется с API через `BudgetFactReconcileBanner`.

## Убрать material из факта

Подрядчик: закупка «Доставлено» → кнопка **«Убрать из факта»** (`POST …/purchases/{id}/status` `{ "status": "cancelled" }`).

Backend: `purchase_service._on_cancelled` → pick `approved`, `refresh_budget_facts`.
