# Renova — реестр расчётов и производных метрик

**Статус:** ACTIVE / LIVING ANNEX  
**Главный документ:** `docs/RENOVA-TECHNICAL-SPECIFICATION.md`  
**Назначение:** фиксировать только доказанные формулы Renova: входы, вычисление, status semantics, source implementation и тест. Наличие UI label само по себе не считается доказательством формулы.

## 1. Правило включения формулы

Формула получает статус `VERIFIED`, только если прочитан implementation source. `TESTED` добавляется только при наличии конкретного regression test/CI path. Если источник или status semantics не установлены, запись остаётся `TBD / UNVERIFIED`.

---

## 2. Денежная арифметика backend

**VERIFIED. Source:** `backend/app/services/budget_service.py` blob `63c991179e4597b7bd324c04115fb9433f72080b`.

Backend budget calculations используют `Decimal(str(value))` и денежное квантование до `0.01` с `ROUND_HALF_UP` перед записью float-compatible значения.

```text
money(x) = Decimal(str(x or 0)).quantize(0.01, ROUND_HALF_UP)
```

Это правило важнее визуального округления mobile UI.

---

## 3. Строка сметы

**VERIFIED.**

```text
estimate_line_amount = quantity_planned × unit_price
```

Source: `_estimate_amount(EstimateLine)` в `budget_service.py`.

---

## 4. План бюджета проекта

**VERIFIED.**

```text
budget_planned =
    Σ(quantity_planned × unit_price for all EstimateLine)
  + Σ(ChangeOrder.amount where status = approved)
```

Результат округляется денежным правилом backend и записывается в `Project.budget_planned`.

Source: `sync_project_budget_planned()`.

### Не входит автоматически

- pending/rejected ChangeOrder;
- фактические Expense;
- Payment сам по себе;
- Receipt сам по себе без ledger hydration.

---

## 5. Purchase fact amount

**VERIFIED.** Расход по закупке создаётся только при `PurchaseStatus ∈ {paid, delivered}`.

```text
amount = money(purchase.total_amount)
if amount <= 0:
    amount = money(Σ(item.qty × item.unit_price))
if amount <= 0:
    Expense не создаётся
```

Source: `expense_from_purchase()`.

Active purchase expense не должен оставаться после перехода purchase в неактивный status; source-protected `disputed/refund/deleted` evidence обычным refresh не уничтожается.

---

## 6. Receipt → Expense status

**VERIFIED.**

```text
if receipt.fns_verified:
    expense.status = confirmed
else:
    expense.status = pending_receipt
```

Source: `expense_from_receipt()`.

`pending_receipt` является active line-projection fact, но не входит в подтверждённый `Project.budget_spent`.

---

## 7. Payment → Expense

**VERIFIED.**

```text
if Payment.status != confirmed:
    no Expense is created by expense_from_payment()
else:
    create/dedupe linked Expense(status=confirmed)
```

Category:

```text
payment_type ∈ {stage, advance, final} → works
otherwise                           → materials
```

---

## 8. Канонический подтверждённый факт бюджета

**VERIFIED.**

```text
budget_spent = Σ(Expense.amount where Expense.status = confirmed)
```

Source: `_reconcile_budget_line_actuals()`.

`pending_receipt` может быть видим в детализации BudgetLine actuals, но не повышает `budget_spent` до подтверждения.

---

## 9. BudgetLine actual projection

**VERIFIED.** Active projection statuses:

```text
{confirmed, pending_receipt}
```

Для каждой active Expense:

1. category должна совпасть с BudgetLine;
2. совпавшая `room_id` даёт +1 specificity;
3. совпавшая `stage_id` даёт +1 specificity;
4. если ровно одна line имеет максимальную specificity — весь amount идёт в неё;
5. иначе amount идёт в системную explicit-unallocated line `[actual-unallocated:category:room:stage]`.

После распределения:

```text
projected_total = Σ(actual_amount assigned to regular lines)
                + Σ(actual_amount assigned to unallocated lines)
expected_total  = Σ(active Expense.amount)

money(projected_total) must equal money(expected_total)
```

Нарушение → `RuntimeError("budget_actual_projection_mismatch")`.

Это fail-closed invariant: система не имеет права «потерять» расход из-за неоднозначной привязки.

---

## 10. Mobile budget reconciliation

**VERIFIED + TESTED.**  
Source: `apps/mobile/lib/domain/budgetFactReconcile.ts` blob `e543e42514bddbcf3fd0b0cf564a8297cfb4ff96`.  
Test: `budgetFactReconcile.test.ts` blob `1cb8a602811d43842fbf269672e14142d609d5aa`.

```text
delta   = listTotal - serverFact
aligned = abs(delta) <= tolerance
```

Default:

```text
tolerance = 1 ₽
```

`serverFact` должен быть каноническим server `budget_spent`, а не локально пересчитанным substitute.

---

## 11. Budget Summary decision model

**VERIFIED. Source:** `apps/mobile/lib/domain/buildBudgetSummaryView.ts` blob `68e96b02dc3f5e2cdda20b6d94871ff9145b9541`.

Input sanitation:

```text
planned = max(0, finite(input.planned, 0))
spent   = max(0, finite(input.spent, 0))
```

Derived values:

```text
deviation = explicit deviation if finite, else spent - planned

deviationPct = explicit finite value, else:
    planned > 0
      ? round_to_0.1((deviation / planned) × 100)
      : 0

remaining = max(0, explicit finite remaining else planned - spent)
margin    = planned - spent

pendingAmounts = only finite amounts > 0
pendingAmount  = round_to_0.01(Σ pendingAmounts)
pendingCount   = count(pendingAmounts)

customerBudget = finite positive input or null
customerBudgetOver = customerBudget == null
    ? 0
    : max(0, spent - customerBudget)
```

Forecast:

```text
forecast = null if input.forecast is null/undefined
otherwise max(0, finite(input.forecast, planned))
```

Decision state priority:

```text
empty         if planned == 0 and spent == 0
over          else if deviation > 0
forecast-risk else if forecast != null and forecast > planned
on-track      otherwise
```

Positive deviation означает факт выше плана.

---

## 12. Progress from stages

**VERIFIED + TESTED.**  
Source: `resolveProjectProgress.ts` blob `efa1e3da7bc4b383823ff899f03784f9eea9e3e7`.  
Test: `resolveProjectProgress.test.ts` blob `b96d9f1305d75940b5862a9617988ef8e0363d09`.

```text
if stages is empty:
    progressFromStages = null
else:
    progressFromStages = round(count(status=done) / count(all stages) × 100)
```

Final resolution:

```text
if osScheduleProgress != null and osScheduleProgress > 0:
    return osScheduleProgress

fromStages = progressFromStages(stages)
if fromStages != null:
    if every stage is done:
        return 100
    if fromStages > dashProgress:
        return fromStages

return dashProgress || 0
```

Следствие: ненулевой authoritative schedule progress имеет приоритет над heuristic stage count; stage-derived progress может только повысить dashboard fallback, кроме explicit all-done=100.

---

## 13. Schedule execution stats

**VERIFIED + TESTED.**  
Source: `scheduleExecutionStats.ts` blob `723b91a7fb61b727fecd2c07ec0a5d032e60d382`.  
Test: `scheduleExecutionStats.test.ts` blob `ad70768c1681a55565b13b6ad25030dd61509257`.

Window:

```text
weekStart = today - 6 calendar days
```

For each WorkOrder:

```text
extensions += 1
    if notes matches /продлен|продление|запрос продления/i

doneThisWeek += 1
    if status == done
    and updated_at.date >= weekStart
    then skip remaining open/overdue logic for this work order

if work status is archived:
    skip open/overdue logic

overdue += 1
    if effectiveEnd < today
    and status != done

todayOpen += 1
    if planned_start <= today <= effectiveEnd
    or start == today
    or end == today
```

где:

```text
effectiveEnd = planned_end || planned_start
```

`extensions` сейчас является text-derived indicator из notes, а не отдельным normalized extension entity. Это важно учитывать при аналитической интерпретации.

---

## 14. Budget periods

**VERIFIED. Source:** `aggregateBudgetByPeriod.ts` blob `f55d73d095477d24856170eab27aebdee48a1596`.

Canonical periods:

```text
week  = today and previous 6 days
month = first day of current month through now
year  = Jan 1 of current year through now
all   = Unix epoch through now
```

`sumRows(rows) = Σ row.amount`.

### Planned share for selected period

For `all`:

```text
periodPlanned = plannedTotal
```

For other periods the current mobile heuristic uses proportional temporal overlap:

```text
projectDuration = max(1 ms, projectEnd - projectStart)
overlap = max(0, min(periodEnd, projectEnd) - max(periodStart, projectStart))
periodPlanned = round(plannedTotal × overlap / projectDuration)
```

If project dates are absent, selected period boundaries are used as fallbacks.

### Bucket allocation heuristic

Current UI distributes `periodPlanned` evenly for chart buckets:

```text
week  → round(periodPlanned / 7) per day
month → round(periodPlanned / 4) per 7-day bucket
year  → round(periodPlanned / 12) per month
```

**Caveat:** month uses `/4` even though a calendar month can produce five 7-day buckets. Поэтому эта величина является визуально-аналитической heuristic, а не бухгалтерским allocation rule. Не использовать её как authoritative commitment/cash-flow plan без отдельной нормализации.

---

## 15. Portfolio budget aggregation

**VERIFIED. Source:** `aggregatePortfolioBudget.ts` blob `74595a831d76df0ae8ddae50cc40ed56beec3922`.

For each project breakdown:

```text
works         += works
materialsPlan += materials_plan
materialsFact += materials_fact
waste         += waste
reserve       += reserve
totalPlan     += budget_planned
totalSpent    += budget_spent
```

For any category row:

```text
variance    = spent - planned
variancePct = planned > 0 ? round(variance / planned × 100) : 0
hasOverrun  = planned > 0 and variance > 0
```

Current row semantics:

```text
works:    planned=works, spent=works
materials planned=materialsPlan, spent=materialsFact
waste:    planned=waste, spent=waste
reserve:  planned=reserve, spent=reserve
total:    planned=totalPlan, spent=totalSpent
```

Only rows where planned > 0 or spent > 0 are returned.

**Caveat:** works/waste/reserve rows currently mirror the same aggregate value into plan and fact, so their variance is structurally zero. Это не следует интерпретировать как доказательство отсутствия отклонения этих категорий; это limitation текущего input breakdown contract.

---

## 16. Material procurement derived counts

**VERIFIED UI derivation. Source:** `OsMaterialsScreen.tsx`.

```text
needBuy   = count(MaterialPick.status in {draft, pending})
ordered   = count(MaterialPick.status == approved)
delivered = count(MaterialPick.status == purchased)

shortage = count(
    (qty_needed || qty) > (qty_delivered || 0)
    and status != purchased
)

openPurchases = count(Purchase.status not in {delivered, cancelled})
unverifiedReceipts = count(receipt.verified == false)
```

Filter semantics:

```text
Купить       → draft | pending
Согласовано  → approved
В факте      → purchased
Не хватает   → (qty_needed || qty) > (qty_delivered || 0)
```

`readyCount` вычисляется отдельным `readyPickIds(picks, purchases)` и не должен заменяться одной проверкой status без чтения этого helper.

---

## 17. Selection pending count

**VERIFIED UI derivation. Source:** `OsSelectionsScreen.tsx` blob `9ccb7fa6b1df87d21372369de73b748f8c7779e1`.

```text
pending = count(SelectionItem.status == proposed)
```

Этот count используется как attention signal для customer и как badge Repair → Подбор.

`over_allowance` приходит как domain/API-derived field; формулу превышения нельзя восстанавливать только из UI. До чтения source producer она остаётся `TBD / UNVERIFIED` в этом реестре.

---

## 18. Непокрытые расчёты — обязательный backlog

Следующие группы должны быть перенесены сюда только после trace implementation → test:

- acceptance pending/age/SLA;
- home KPI detail;
- project phase/lifecycle;
- estimate layers and margin semantics;
- category/floor/room expense analytics;
- procurement next-action priority;
- materials readiness;
- notification/attention counts;
- rework and quality-control SLA;
- contractor portfolio KPI;
- manager dashboard portfolio metrics;
- schedule/version delay calculations;
- warranty metrics после merge #287;
- chat unread/atomic delivery metrics после merge #282;
- observability/SLO formulas после merge #283.

До заполнения этих разделов любые цифры из соответствующих UI нельзя автоматически считать documented authoritative formula.
