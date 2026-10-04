# Renova — реестр расчётов и производных метрик

**Статус:** ACTIVE / LIVING ANNEX. **Сверка:** 2026-09-08, код `95dd4a8e117289df11e1300891490768c22f585f`.
**Главный документ:** `docs/RENOVA-TECHNICAL-SPECIFICATION.md`.
Предыдущая полная редакция сохранена в `history/CALCULATION-REGISTRY-before-2026-09-08.md`. Исправления ниже описывают текущую реализацию и её ограничения; они не исправляют код вычислений. Открытые #318 и backlog §18 нельзя считать завершёнными.

## 1. Правила

SOURCE VERIFIED означает прочитанную формулу, не признание её экономически правильной. TESTED/CI VERIFIED требует конкретного теста/run. Для каждой новой метрики обязательны источник, статусы, дата/as-of, валюта, округление, пропуски, отмена/возврат, область роли и reconciliation. Нельзя считать null нулём, условный план фактом, отсутствие отклонения результатом измерения без двух независимых входов.

## 2. Денежная арифметика backend

Source `backend/app/services/budget_service.py`, blob `cf952ea481d15060ad2287f2366a7906c9669822`.

```text
money(x) = Decimal(str(x or 0)).quantize(0.01, ROUND_HALF_UP)
```

Это квантование при денежной записи, а не визуальное округление клиента. Наличие float-compatible хранения требует проверок на крайних суммах; не переносить UI tolerance в финансовый ledger.

## 3. Строка сметы

```text
estimate_line_amount = quantity_planned × unit_price
```

Source `_estimate_amount(EstimateLine)` в budget_service. Строка плана не доказательство оплаченного/признанного расхода.

## 4. План бюджета проекта

```text
budget_planned = Σ(quantity_planned × unit_price for all EstimateLine)
               + Σ(ChangeOrder.amount where status = approved)
```

Source `sync_project_budget_planned`, денежное округление перед Project.budget_planned. Pending/rejected ChangeOrder, Expense/Payment и Receipt сами по себе не добавляют план.

## 5. Закупка и признание расхода

Source `expense_from_purchase`: Expense создаётся при PurchaseStatus в {paid, delivered} и положительной сумме.

```text
amount = money(purchase.total_amount)
if amount <= 0: amount = money(Σ(item.qty × item.unit_price))
if amount <= 0: no Expense
```

При неактивном status обычный активный purchase expense не должен сохраняться; protected disputed/refund/deleted evidence нельзя разрушать обычным refresh. Текущий purchase_service.py имеет partial (частично оплачено) и returned (после delivered), а не отсутствие таких состояний. Точная сумма частичной оплаты, физический возврат и денежный refund — разные понятия; весь partial/reverse путь должен быть отдельно доказан G06.

## 6. Receipt → Expense

```text
fns_verified → confirmed
otherwise    → pending_receipt
```

Source `expense_from_receipt`. pending_receipt входит в active line projection, но не в подтверждённый Project.budget_spent. Duplicate evidence не должно повторно признаваться через другой источник.

## 7. Payment → Expense

Source `expense_from_payment`:

```text
Payment.status != confirmed → no new Expense
Payment.status == confirmed → create/dedupe linked confirmed Expense
payment_type in {stage, advance, final} → works
otherwise                              → materials
```

Manual evidence→confirmed Payment→единственный Expense квалифицирован в #297. Это не даёт идемпотентность отдельному источнику создания invoice в чате (#316).

## 8. Подтверждённый факт

```text
budget_spent = Σ(Expense.amount where Expense.status = confirmed)
```

Source `_reconcile_budget_line_actuals`. Не заменять величину max(receipt,expense,estimate_fact), клиентской суммой или общей суммой банковских движений.

## 9. BudgetLine actual projection

Active: confirmed и pending_receipt. Для совпавшей category, room даёт+1 specificity, stage ещё+1. Единственный максимум получает сумму; неоднозначный максимум направляется в explicit-unallocated line `[actual-unallocated:category:room:stage]`.

```text
projected_total = Σ(regular line actuals) + Σ(unallocated line actuals)
expected_total = Σ(active Expense.amount)
money(projected_total) == money(expected_total)
```

Нарушение: `budget_actual_projection_mismatch`. Этот invariant предотвращает исчезновение расходов при неоднозначной привязке; он не подтверждает исходный расход без его собственного жизненного цикла.

## 10. Mobile reconciliation

Source `apps/mobile/lib/domain/budgetFactReconcile.ts` blob `e543e42514bddbcf3fd0b0cf564a8297cfb4ff96`; test `budgetFactReconcile.test.ts` blob `1cb8a602811d43842fbf269672e14142d609d5aa`.

```text
delta   = listTotal - serverFact
aligned = abs(delta) <= tolerance
tolerance = 1 ₽ by default
```

ServerFact — канонический server budget_spent. Tolerance — UI reconciliation, не разрешение терять рубль в ledger.

## 11. Budget Summary decision model

Source `buildBudgetSummaryView.ts`, blob `957411d46266104a39ac2b0d16140a911ffb8351`.

```text
planned = max(0, finite(input.planned, 0))
spent   = max(0, finite(input.spent, 0))
deviation = explicit finite deviation else spent - planned
deviationPct = explicit finite value else:
    planned > 0 ? round_to_0.1(deviation / planned × 100) : 0
remaining = max(0, explicit finite remaining else planned - spent)
margin    = planned - spent
pendingAmounts = finite positive pending amounts
pendingAmount = round_to_0.01(Σ pendingAmounts)
pendingCount = count(pendingAmounts)
customerBudget = finite positive input else null
customerBudgetOver = customerBudget == null ? 0 : max(0, spent - customerBudget)
forecast = null for null/undefined input, else max(0, finite(input.forecast, planned))
```

Приоритет: empty при planned=spent=0; иначе over при deviation>0; иначе forecast-risk при forecast>planned; иначе on-track. `margin` здесь остаток плана, не доказанная прибыль подрядчика. Source sanitation не заменяет явного missing-data/error state вызывающего экрана.

## 12. Progress from stages

Source `resolveProjectProgress.ts`, blob `efa1e3da7bc4b383823ff899f03784f9eea9e3e7`; test blob `b96d9f1305d75940b5862a9617988ef8e0363d09`.

```text
empty stages → null
otherwise progressFromStages = round(done stages / all stages × 100)
if osScheduleProgress != null and osScheduleProgress > 0: use osScheduleProgress
else if every stage done: 100
else if stage-derived progress > dashProgress: use stage-derived progress
else: dashProgress || 0
```

Это существующая resolution heuristic. Количество done stages не взвешенная трудоёмкость и не факт полной сдачи/оплаты/документов. Нулевой authoritative schedule progress и fallback требуют явного контракта, не автоматического улучшения цифры на Home.

## 13. Schedule execution stats

Source `scheduleExecutionStats.ts` blob `723b91a7fb61b727fecd2c07ec0a5d032e60d382`; test blob `ad70768c1681a55565b13b6ad25030dd61509257`.

```text
weekStart = today - 6 calendar days
extensions += 1 if notes match /продлен|продление|запрос продления/i
doneThisWeek += 1 if status=done and updated_at.date >= weekStart
then skip remaining open/overdue logic for that done row
archived → skip open/overdue
otherwise overdue += 1 if effectiveEnd < today and status != done
todayOpen += 1 if start <= today <= effectiveEnd or start==today or end==today
effectiveEnd = planned_end || planned_start
```

Extensions — text-derived indicator, не normalized extension event. Updated_at может не быть самостоятельным immutable completion timestamp; пригодность управленческого показателя требует проверки producer semantics.

## 14. Budget periods — исправлено #318 (largest-remainder allocation)

Source `aggregateBudgetByPeriod.ts`, blob `81091613519c429d403e212b294aff9b5f8bf066`.

```text
week: today and previous 6 days
month: first day of current month through now
year: Jan 1 through now
all: Unix epoch through now
sumRows = Σ row.amount
all periodPlanned = plannedTotal
projectDuration = max(1 ms, projectEnd - projectStart)
overlap = max(0, min(periodEnd, projectEnd) - max(periodStart, projectStart))
periodPlanned = round(plannedTotal × overlap / projectDuration)
```

Отсутствующие даты проекта заменяются period boundaries. `allocateEven(total, n)` распределяет `periodPlanned` по `n` интервалам в целых копейках (largest-remainder method: `base = trunc(totalCents/n)`, остаток `totalCents - base*n` копеек раздаётся по одной первым `remainder` интервалам) — гарантирует `Σ(bucket.planned) === periodPlanned` до копейки для любого `n`, включая month (реальное число недельных интервалов месяца — 4 или 5 в зависимости от количества дней, а не хардкод `/4`).

**ИСПРАВЛЕННЫЙ ДЕФЕКT (был до 7c832070):** 29–31-дневный месяц создавал 5 интервалов по 1/4 от хардкода; при periodPlanned 100000 получалось 125000 (125% плана). Воспроизведено counterexample-тестом, зафиксировано регрессией.

Regression-тесты: `aggregateBudgetByPeriod.test.ts` — exact-125%-counterexample, `allocateEven` для n=4..31 и произвольных сумм включая копейки, `buildPeriodBuckets('month')` на реальном текущем месяце.

## 15. Portfolio budget — исправлено #318 (явный factAvailable вместо мнимого нуля)

Source `aggregatePortfolioBudget.ts`, blob `589cbb97bb410f5186a2cc751ac6aeaaa133819b`.

Агрегируются works, materials_plan, materials_fact, waste, reserve, budget_planned, budget_spent.

```text
variance    = spent - planned
variancePct = planned > 0 ? round(variance / planned × 100) : 0
hasOverrun  = factAvailable and planned > 0 and variance > 0
```

Current row semantics: works→(works, `works_fact` от backend `quantity_actual`, `factAvailable=true` когда backend его вернул, иначе `false`); materials→(materialsPlan, materialsFact, `factAvailable=true`); waste→(waste, waste, `factAvailable=true` — genuine zero variance, waste amount известен на создании, это не заглушка); reserve→(reserve, reserve, `factAvailable=false` — производный остаток `budget_planned - works - materials - waste`, у него нет независимого ledger-факта); total→(totalPlan, totalSpent, `factAvailable=true`).

**ИСПРАВЛЕННЫЙ ДЕФЕКТ (был до 7c832070):** works/reserve variance раньше была структурно 0 (факт=план подставлялся вместо отсутствия данных), что маскировало реальный перерасход по работам как "в пределах плана". Backend `budget_breakdown` (`backend/app/api/v1/analytics.py`) теперь считает и возвращает `works_fact` из `EstimateLine.quantity_actual`; когда backend его не вернул, mobile помечает строку `factAvailable=false` вместо изобретения нулевого отклонения. UI (`PortfolioCategoryBreakdown.tsx`) показывает «факт не отслеживается отдельно» по `factAvailable`, а не по эвристике равенства plan/fact.

## 16. Материалы — актуальная количественная семантика

Source `apps/mobile/components/screens/OsMaterialsScreen.tsx`, blob `310f8c9dc20c9580baa2772a7397062fb0456d1b`; helpers `lib/domain/materialSupply.ts` и `procurementNextAction.ts`.

```text
needBuy = count(quantityToBuy(pick) > 0)
approved = count(status == approved)
available = count(isMaterialAvailable(pick))
shortage = count(!isMaterialAvailable(pick))
openPurchases = count(status not in {delivered, cancelled, returned})
unverifiedReceipts = count(!receipt.verified)
readyCount = readyPickIds(picks, purchases, role).length
```

`isMaterialAvailable` использует API material_available, если boolean передан; иначе сравнивает totalAvailableQty+Number.EPSILON с requiredQty. Это UI fallback, не отдельный authoritative stock ledger.

Фильтры: Купить→quantityToBuy>0; Согласовано→approved; Доступно→isMaterialAvailable; Не хватает→!isMaterialAvailable. Старые draft/pending/purchased counts больше не текущий контракт. Supply source, qty_available, qty_delivered и qty_to_buy определяются MATERIAL-SUPPLY-CONTRACT; purchase eligibility дополнительно проверяет responsibility и price provenance. Ready count не равен одному статусу approved.

## 17. Selection pending count

Source `OsSelectionsScreen.tsx`, blob `8a52566cfd463083b5055318871cc9668f1edf39`.

```text
pending = count(SelectionItem.status == proposed)
```

Используется attention/badge. `over_allowance` определяется producer API; одна подпись UI не доказательство его формулы. До полной сверки producer/test — TBD / UNVERIFIED.

## 18. Material actuals — explicit zero preserved (исправлено #379)

Source `backend/app/api/v1/analytics.py` (`analytics` endpoint, `materials_fact`) and `backend/app/services/estimate_service.py` (`material_stats`).

```text
materials_fact = Σ quantity_actual × unit_price   (materials только)
```

`EstimateLine.quantity_actual` — non-null numeric column, default `0`; `0` здесь означает измеренный факт "израсходовано/остаток ровно ноль", а не "не введено". Раньше обе точки считали `(quantity_actual or quantity_planned) * unit_price`: в Python `0` — falsy, поэтому явный ноль подменялся plan-количеством и `materials_fact`/`material_stats.actual` показывали план вместо факта. Ноль подстановки не имеет — это тот же класс дефекта, что #318 (works_fact) и mobile `resolveConfirmedPendingPayments`/`bucketCountRead` (не путать null/unknown с 0), только здесь unknown-состояния в схеме нет вовсе: поле non-nullable, значит "не введено" не существует как отдельное состояние и не должно быть выдумано через falsiness. Regression: `backend/tests/test_material_actuals_zero.py` — explicit zero, positive actual, смешанные material/work строки, `material_stats` reconciliation.

**Единое определение (EST-007).** «Факт материалов сметы» везде = `Σ quantity_actual × unit_price` по строкам `material`: `GET /analytics` (`materials_fact`), `GET /analytics/budget-breakdown` (`materials_fact`), `GET /analytics/budget-category-alerts`, `GET /estimate/materials-stats` (`actual`). Прежний вариант `Σ qty × price` по `MaterialPick` в статусах `approved`/`purchased` убран: согласованное не равно купленному. Денежный факт — отдельная величина: `budget_spent` (§8, подтверждённые `Expense`); это не факт сметы и не должен с ним смешиваться. `quantity_actual` вводится и после фиксации сметы (факт — не смета); план и цена после фиксации заморожены. Regression: `backend/tests/test_estimate_materials_audit_fixes.py`.

## 18a. Нормы расхода материалов комнаты — единый канон (EST-030)

Источник истины — строки сметы, которые backend сохраняет: `backend/app/services/calc/estimate.py` (`generate_lines`, `paint_liters`, `wallpaper_rolls`, константы норм). Остальные реализации обязаны совпадать с ним; общие эталоны — `packages/calc-engine/reference-cases.json`, их читают `backend/tests/test_calc_reference_cases.py` и `apps/mobile/lib/calc-engine/referenceCases.test.ts` (оба входят в CI: pytest и `npm run mobile:test`).

```text
краска, л   = стены × 2 слоя / 8 м²/л на слой × 1,05        (комната 4,2×3,1×2,7, проёмы 2 м²: 9,82 л)
обои, рул.  = ceil(стены × 1,15 / 5 м²)                     запас 15% на подгонку рисунка, 0 при нулевых стенах
плитка      = площадь × 1,10   (ванная: (пол + стены) × 1,10)
ламинат     = пол × 1,08
штукатурка  = стены × 8 кг/м²
```

Приведено к канону: `material_calculator.py` (краска была 0,15 л/м² × 2 слоя = 11,23 л, обои — `round()` вместо потолочного округления и минимум 1 рулон, ламинат 1,07, примечание «запас 7%» при диагонали 12%, отрицательные площади), краска в `generate_lines` (раньше без второго слоя: 4,91 л при названии строки «2 слоя»; изменяет только вновь сгенерированные строки, сохранённые сметы не пересчитываются). Мобильный `calc-engine` уже соответствовал канону; добавлен `wallpaperRolls`.

Оставшиеся намеренные отличия: (1) `calc_room_materials` выводит и плитку, и ламинат — это варианты покрытия пола на выбор, не две одновременные строки; (2) раскладка плитки `diagonal`/`complex` (запас 15%/20%) есть только в `material_calculator`; (3) `calcRoomMetrics` (mobile) по умолчанию считает проёмы 0 м², backend `calc_room_metrics` — 2 м²: эталоны задают проёмы явно; (4) `packages/calc-engine` — устаревшая копия, нигде не импортируется, поддерживается лишь тестом `src/index.test.ts` (входит в `mobile:test`); (5) результат `calc-materials` не сохраняется и не питает потребности (открыто, EST-030).

## 19. Непокрытые расчёты и их приёмка

Сохраняется обязательный backlog: acceptance pending/age/SLA; home KPI; project phase/lifecycle; estimate layers/margin; category/floor/room analytics; procurement priority/readiness; notification/attention/unread counts; rework/quality SLA; contractor/manager portfolio metrics; schedule/version delay; warranty после уже merged #295; chat после уже merged #292; external observability/SLO #235/#283.

Для каждой группы: перечень UI consumers→source function→input/status/as-of→independent expected value→edge cases→test ID→CI artifact. Формулы, подтверждённые чтением, не становятся полными бизнес-результатами автоматически. Refunded/disputed/partial/pending, duplicate evidence и недоступный источник обязательны там, где применимы. Текущий аудит не заменяет выполнение этих тестов и не закрывает #318.
