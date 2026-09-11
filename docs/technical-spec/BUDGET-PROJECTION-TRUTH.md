# Budget projection truth — #318

Status: **candidate implementation; not complete until required CI and review are green**.

This annex is governed by `AGENTS.md`, the Product Completion Mandate and the calculation registry. It narrows two existing client-side analytical projections. It does not redefine the authoritative expense ledger, `Project.budget_spent`, payment truth or Golden Path acceptance.

## 1. Period semantics

The selected period is always an **as-of range**:

- `week`: current local calendar day and the previous six calendar days;
- `month`: first local calendar day of the current month through the current local calendar day;
- `year`: 1 January through the current local calendar day;
- `all`: the complete project projection.

Month/year detail must not create buckets after the as-of day. Future expense rows are not included in current-period fact.

Project date strings in `YYYY-MM-DD...` form are parsed as local calendar dates rather than JavaScript UTC-midnight dates. Duration and overlap are measured as inclusive **calendar-day counts** using UTC day ordinals; this prevents DST 23/25-hour days from changing a date-granularity allocation.

## 2. Planned share

The current product has no authoritative phased budget/cash-flow schedule at this projection layer. Therefore the period plan remains explicitly a **linear estimate**, not a measured phased plan.

For a non-`all` period:

```text
projectDays = inclusive calendar days(projectStart .. projectEnd)
overlapDays = inclusive calendar days(period ∩ project)
periodPlanned = round_to_kopeck(plannedTotal × overlapDays / projectDays)
```

When an endpoint date is unavailable, the corresponding selected-period boundary is used as the existing fallback. This fallback is an estimate and must not be described as an authoritative project cash-flow curve.

For `all`:

```text
periodPlanned = round_to_kopeck(plannedTotal)
```

## 3. Bucket conservation

Buckets partition the same as-of range used to compute `periodPlanned`:

- week → seven local calendar-day buckets;
- month → consecutive seven-day buckets with the last bucket truncated at the as-of day;
- year → elapsed calendar months only, with the current month truncated at the as-of day;
- all → one bucket.

Each bucket receives a weight equal to its calendar-day overlap with the project. Planned value is allocated in integer kopecks with largest-remainder reconciliation.

Mandatory invariant:

```text
Σ(bucket.planned) == periodPlanned     // exact to 0.01 ₽
```

A 29–31 day month may contain five weekly buckets; bucket count never multiplies the plan. The historical `5 × round(periodPlanned / 4)` failure is forbidden.

## 4. Portfolio category fact

`BudgetBreakdown` currently exposes:

- estimate-based works plan;
- materials plan;
- a separate calculated `materials_fact`;
- waste/reserve values used in the breakdown construction;
- authoritative project-level `budget_planned` / `budget_spent`.

It does **not** expose independent, ledger-backed category actuals for works, waste and reserve. Therefore the portfolio aggregator must not set `spent = planned` for those categories.

Current category contract:

```text
works.spent     = null   // unavailable
materials.spent = Σ(materials_fact)
waste.spent     = null   // unavailable
reserve.spent   = null   // unavailable
total.spent     = Σ(budget_spent)

if spent is null:
    variance = null
    variancePct = null
    hasOverrun = false
else:
    variance = spent - planned
    variancePct = planned > 0 ? round(variance / planned × 100) : null
```

The UI renders `факт недоступен` for unavailable category fact. It must not render zero variance or otherwise imply that actual equals plan.

`materials_fact` remains the calculation supplied by the existing budget-breakdown API; this annex does not promote it to the same ledger authority as total `budget_spent`.

## 5. Acceptance evidence

Before #318 is merge-eligible:

- a five-bucket 30/31-day month conserves 100% of period plan, not 125%;
- month-to-date has no future bucket and excludes future expense rows;
- week/year rounding remainder is reconciled exactly to 0.01 ₽;
- leap-year elapsed plan uses 60/366 calendar days through 29 February;
- all bucket sums equal `periodPlanned` to the kopeck;
- works/waste/reserve category actual, variance and variance percent are explicitly unavailable rather than zero-by-construction;
- materials and total continue to aggregate their existing actual inputs;
- the portfolio UI is type-safe with nullable category fact and explicitly labels unavailable fact;
- mobile domain/type contracts, required CI and technical-spec integrity are green.

## 6. Boundaries

This change does not close:

- #379 material `quantity_actual` truth semantics;
- authoritative category ledger allocation for works/materials/waste/reserve;
- real phased OTB/cash-flow planning;
- payment/refund/dispute reconciliation;
- GP1–GP8 or G04/G05;
- multi-contractor scope allocation;
- `PRODUCT COMPLETE ON CONTROLLED RUNTIME` or `PRODUCTION VERIFIED`.

The general calculation registry sections 14–15 should be consolidated with this annex when parallel finance-truth branches are merged/rebased. They are intentionally not rewritten in this branch to avoid a mechanical merge conflict with the concurrent #379 calculation-registry correction.