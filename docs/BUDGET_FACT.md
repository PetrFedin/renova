# Контракт «факт бюджета» (UI ↔ API)

Актуальный технический контракт Renova: как сервер формирует финансовый ledger проекта, как mobile строит детальный список расходов и как UI обнаруживает расхождение между списком и каноническим `budget_spent`.

## Источники данных

| Поле / экран | Источник | Назначение |
|--------------|----------|------------|
| **Факт на сводке** | `GET …/os/budget` → `budget_spent` | Канонический server ledger подтверждённых расходов |
| **Budget-line actuals** | `backend/app/services/budget_service.py` → `_reconcile_budget_line_actuals()` | Проекция активных расходов на строки плана без двойного учёта |
| **Список «Расходы»** | `buildUnifiedBudgetExpenses()` | Client unified list без дублей |
| **Аналитика (категории, этажи)** | Те же `unifiedRows` | Breakdown из единого mobile списка |
| **Оплаты подрядчикам** | `payments` | В расход попадают только после server-side подтверждения и создания `Expense` |

## Server ledger: source hydration

`backend/app/services/budget_service.py` является текущим защитным слоем над legacy budget implementation и сохраняет source identity (`receipt_id`, `payment_id`, `purchase_id`, `material_pick_id`) при дедупликации.

### Receipt → Expense

- receipt создаёт/обновляет одну связанную `Expense`;
- `fns_verified=true` → `Expense.status = confirmed`;
- неподтверждённый receipt → `Expense.status = pending_receipt`;
- source-protected состояния `disputed`, `refund`, `deleted` не перезаписываются обычной hydration-логикой.

### Payment → Expense

`Payment` создаёт расход только при `PaymentStatus.confirmed`.

### Purchase → Expense

Расход по закупке создаётся только для `PurchaseStatus.paid` или `PurchaseStatus.delivered`.

Сумма:

```text
purchase_fact = total_amount,
если total_amount <= 0:
    purchase_fact = Σ(item.qty × item.unit_price)
если итог <= 0:
    Expense не создаётся
```

`cancelled`/`returned` и другие неактивные purchase states не должны оставлять stale active purchase expense после refresh; dispute/refund/delete evidence сохраняется.

## План бюджета

Точная серверная формула:

```text
estimate_line_amount = quantity_planned × unit_price
budget_planned = Σ(estimate_line_amount) + Σ(approved ChangeOrder.amount)
```

Денежные значения приводятся к двум знакам после запятой через `Decimal` + `ROUND_HALF_UP`.

## Проекция факта на BudgetLine

Активными для line projection являются `Expense.status ∈ {confirmed, pending_receipt}`.

Для каждой такой `Expense` сервер ищет единственную наиболее специфичную BudgetLine той же категории:

1. совпадение категории обязательно;
2. строка с подходящей `room_id` повышает specificity;
3. строка с подходящей `stage_id` повышает specificity;
4. если ровно одна строка имеет максимальную specificity — расход назначается ей;
5. если подходящей строки нет или лучший вариант неоднозначен — создаётся/используется системная строка `[actual-unallocated:category:room:stage]` с `planned_amount = 0`.

Каждый активный расход проектируется ровно один раз. После расчёта выполняется invariant:

```text
Σ(projected BudgetLine actuals) == Σ(active Expense amounts)
```

с денежным округлением до копеек. Нарушение останавливает операцию ошибкой `budget_actual_projection_mismatch`.

## Канонический `budget_spent`

`project.budget_spent` включает **только** `Expense.status == confirmed`:

```text
budget_spent = Σ(confirmed Expense.amount)
```

`pending_receipt` участвует в line-level projection, чтобы факт не исчезал из детализации, но **не** повышает канонический подтверждённый `budget_spent` до прохождения подтверждения.

## Mobile unified list

Mobile строит детальный список по текущему контракту без повторного признания одного источника:

```text
unified = receipts
        + os_expenses (без дубля source receipt_id / payment_id)
        + material_picks WHERE status = 'purchased'
          только если pick ещё не покрыт Expense той же purchase
```

Сервер создаёт `Expense(purchase_id)` на `paid`. Если `paid` был пропущен и закупку сразу перевели в `delivered`, `delivered` является допустимым source state для того же расхода. Mobile предпочитает `Expense`-строку и не добавляет поверх неё связанные purchased material picks.

Не считаются подтверждённым фактом только по своему наличию:

- `material_picks` со статусами `draft`, `pending`, `approved`;
- `payments`, пока они не подтверждены сервером;
- план сметы (`budget_planned` / estimate);
- cancelled/returned purchase как active purchase fact.

## Reconcile UI ↔ server

Код: `apps/mobile/lib/domain/budgetFactReconcile.ts`.

```text
delta = listTotal - serverFact
aligned = abs(delta) <= tolerance
```

Default `tolerance = 1 ₽` для UI-округления/timing. При `|listTotal - budget_spent| > 1 ₽` UI должен показывать `BudgetFactReconcileBanner`, а не скрывать расхождение.

## Ownership UI

| Тип строки | Метка | Экономический смысл |
|------------|-------|---------------------|
| Чек / receipt | Вы / источник чека | source evidence; окончательное включение зависит от server expense state |
| Os Expense | Учёт | серверная ledger-строка |
| Purchased material pick без уже связанной Expense | Подрядчик | mobile fallback/detail source без дубля purchase Expense |

## E2E и regression contract

Исторически `e2e/customer-path.spec.ts` проверяет цепочку scan `+500` → рост `budget_spent` → delete → rollback. Текущий release verdict должен опираться на exact-head CI, а не на существование этого сценария в репозитории.

Backend financial integrity дополнительно обязан сохранять:

- одну экономическую операцию → максимум одну активную ledger recognition;
- source identity при дедупликации;
- невозможность silent loss при неоднозначной BudgetLine — используется explicit unallocated line;
- `budget_actual_projection_mismatch` как fail-closed invariant;
- cancelled/returned purchase не остаётся активным purchase fact;
- protected dispute/refund/delete evidence не уничтожается обычным refresh.

## «Убрать из факта» закупку

UI переводит закупку в `cancelled` через purchase status API с явным подтверждением destructive financial effect. Backend refresh удаляет stale active purchase expense, а связанные material needs/history сохраняются согласно purchase/material state machine.

## Связь с общей спецификацией

Главный системный документ: `docs/RENOVA-TECHNICAL-SPECIFICATION.md`. Этот файл является специализированным финансовым приложением и не должен вводить альтернативную архитектуру или отдельную формулу, противоречащую `budget_service.py` и тестам.
