# Renova — Property Lifecycle Intelligence Contract

**Date:** 2026-10-08  
**Status:** RESEARCH / LIFECYCLE DECISION-SUPPORT CONTRACT  
**Implementation gate:** after Property Operations Network deterministic foundations and sufficient admitted service-history coverage.  
**Depends on:** Property Passport / installed-asset identity, Property Operations Network, Property Action Engine, Intervention Optimizer, canonical Service/Inspection/Warranty/Cost domains.  
**Authority rule:** Lifecycle Intelligence explains historical performance and compares future scenarios. It never becomes authority for safety, replacement approval, procurement, accounting books, valuation, warranty acceptance, or maintenance closure.

## 1. Purpose

Property Operations Network answers:

`what service demand is coming, what capacity/supply exists, and how should work be coordinated?`

Property Lifecycle Intelligence answers:

`what has this asset/cohort actually cost and experienced over time, how does it compare with evidence-sufficient peers, and what repair/replacement scenarios should an authorised person consider?`

Canonical progression:

```
verified asset identity
-> installation / commissioning history
-> service / failure / downtime / warranty events
-> admitted actual costs
-> deterministic lifecycle accounting
-> cohort eligibility
-> descriptive reliability statistics
-> scenario comparison
-> approved portfolio replacement / CapEx planning
-> later predictive reliability only when qualified
```

## 2. Three maturity layers

### Layer 1 — deterministic lifecycle accounting

Required first.

Uses only admitted facts and explicit accounting rules.

Outputs:
- age / in-service duration;
- maintenance history;
- repair event history;
- actual cost history;
- downtime history where measured;
- warranty state/history;
- replacement history;
- current known lifecycle obligations.

### Layer 2 — cohort statistics

Allowed only when comparable assets and sufficient coverage exist.

Outputs:
- failure/service frequency;
- repair-cost distributions;
- downtime distributions;
- replacement-age distributions;
- maintenance-compliance comparisons;
- evidence-quality distributions.

### Layer 3 — predictive reliability

Deferred until sufficient actual history and validation.

Possible outputs:
- failure-risk window;
- expected intervention interval;
- probability/range of major repair;
- replacement timing scenario.

Prediction never replaces deterministic obligations or source-backed manufacturer guidance.

## 3. Canonical lifecycle identity

Lifecycle analysis requires a stable asset identity.

Minimum identity may include:
- property;
- asset/system type;
- manufacturer;
- model;
- variant/configuration;
- serial/batch where available;
- installation date;
- commissioning date;
- location/room/system;
- installer/provider;
- warranty identity;
- source provenance.

If exact model/installation date is unknown, analysis coverage must be reduced explicitly.

## 4. Lifecycle event ledger

Lifecycle Intelligence consumes admitted events such as:

- installed;
- commissioned;
- maintenance_due;
- service_started;
- service_completed;
- inspection_completed;
- defect_detected;
- failure_detected;
- repair_started;
- repair_completed;
- part_replaced;
- asset_replaced;
- warranty_claim_opened;
- warranty_claim_accepted/rejected;
- recall_match_confirmed;
- recall_remediated;
- downtime_started/ended;
- cost_posted/reconciled;
- source_corrected/superseded.

The lifecycle projection must preserve event lineage rather than overwrite history.

## 5. Deterministic lifecycle accounting

For every asset, calculate only from explicit source-backed events.

Candidate metrics:

### Age
`analysis_date - admitted_installation_or_commissioning_date`

Expose which start date was used.

### Service count
Count admitted service events meeting the policy definition.

### Repair count
Count admitted repair events; do not mix routine maintenance and repair.

### Cumulative maintenance cost
Sum reconciled/actual maintenance cost classified to the asset.

### Cumulative repair cost
Sum reconciled/actual repair cost classified to the asset.

### Downtime
Sum measured downtime intervals where defined.

### Replacement count
Count admitted component/asset replacement events according to hierarchy rules.

Unknown source periods remain gaps.

## 6. Cost semantics

Costs must distinguish:

- quote;
- approved budget;
- committed;
- invoiced;
- paid;
- actual/reconciled.

Lifecycle actuals should default to reconciled actual cost where available.

Never mix forecast and actual in one total without labelled decomposition.

## 7. Cost attribution

Cost may be:
- directly attributed to one asset;
- allocated across multiple assets;
- allocated across property/system;
- unallocated.

Allocation rules must be explicit/versioned.

Example:
a shared HVAC service invoice covering 12 units cannot be silently assigned fully to each unit.

## 8. Cost categories

Recommended categories:

- planned maintenance;
- corrective repair;
- emergency repair;
- inspection;
- consumables;
- spare parts;
- labour;
- travel/callout;
- commissioning;
- warranty-covered cost;
- owner-paid deductible/non-covered cost;
- replacement acquisition;
- installation/replacement labour;
- disposal/removal where measured.

Keep tax/VAT semantics explicit.

## 9. Warranty value accounting

Warranty analysis should distinguish:

- gross repair/service cost;
- amount covered by warranty;
- amount paid by owner/operator;
- rejected/unsupported claim;
- administrative/diagnostic cost if measurable;
- avoided owner payment only when directly evidenced.

Do not call theoretical manufacturer coverage "savings".

## 10. Warranty Value at Risk

A planning measure may identify future value potentially lost if required conditions are missed.

Inputs may include:
- remaining warranty period;
- documented maintenance conditions;
- current maintenance compliance;
- required authorised-provider conditions;
- open evidence gaps;
- known repair exposure.

Output should be expressed as:
- obligation/risk state;
- covered components if known;
- source;
- evidence gaps;
- optional sourced financial exposure range.

No invented monetary value when coverage/cost basis is unknown.

## 11. Downtime definition

Downtime must be defined per asset/system.

Possible meanings:
- fully unavailable;
- degraded service;
- room unusable;
- system partially unavailable.

Never aggregate unlike downtime definitions without normalisation.

## 12. Failure taxonomy

Distinguish:

- symptom;
- defect;
- confirmed failure;
- degraded performance;
- preventive intervention;
- inspection finding;
- recall remediation;
- user-caused damage where confirmed;
- installation defect where confirmed;
- unknown cause.

A complaint or service call is not automatically a failure event.

## 13. Root-cause provenance

Root cause states:

- confirmed;
- probable;
- suspected;
- unknown.

Confirmed root cause requires the source class defined by policy.

AI-extracted narrative can suggest classification for review but cannot mark a cause confirmed.

## 14. Evidence quality dimension

Every asset/cohort statistic should account for evidence coverage.

Example coverage fields:
- installation identity coverage;
- service-history coverage;
- cost coverage;
- downtime coverage;
- failure classification coverage;
- warranty coverage.

Do not compare "reliable" and "unreliable" assets when one cohort simply has better documentation.

## 15. Cohort definition

A cohort must be reproducible from explicit dimensions.

Candidate dimensions:
- manufacturer;
- model;
- variant;
- asset class;
- installation year;
- geography/climate zone where relevant and sourced;
- building/use type;
- installation environment;
- duty cycle if measured;
- maintenance regime;
- installer/provider;
- firmware/version where material;
- warranty regime.

Every benchmark exposes its cohort definition.

## 16. Cohort eligibility gate

Before an asset enters a benchmark cohort, require:

- sufficient identity;
- compatible event taxonomy;
- sufficient observation period;
- minimum history coverage;
- no known duplicate identity;
- policy-defined data quality.

Assets failing eligibility remain visible but excluded from benchmark denominator.

## 17. Minimum sample rule

No reliability benchmark should be shown as stable without an explicit minimum sample/observation threshold.

Thresholds must be configured by metric and validated statistically.

If insufficient:
- show "insufficient cohort";
- optionally show raw observations;
- do not fabricate percentile/rank.

## 18. Exposure denominator

Failure frequency requires an exposure denominator.

Possible denominators:
- asset-years;
- operating hours where measured;
- cycles where measured;
- occupied months;
- service intervals.

Simple `failures / assets` may be misleading when observation periods differ.

## 19. Descriptive reliability metrics

Possible metrics:

### Failure incidence
`confirmed_failures / exposure_units`

### Service incidence
`corrective_service_events / exposure_units`

### Mean/median time between confirmed failures
Only where start/end/event history supports it.

### Repair-cost distribution
Median, p25/p75, p90 where sample supports it.

### Downtime distribution
Median and percentile bands using compatible downtime definition.

### Replacement-age distribution
Age-at-replacement distribution for a comparable cohort.

### Preventive-compliance rate
`on_time_required_maintenance_events / due_events`

These are descriptive, not causal.

## 20. Survivorship and censoring

Cohort statistics must account for assets that have not yet failed/replaced.

Do not calculate replacement age from only replaced assets and imply it is expected lifespan.

Later statistical models may use survival-analysis methods, but assumptions must be documented.

## 21. Component Reliability Benchmarks

A benchmark output should show:

- cohort definition;
- sample size;
- exposure;
- observation period;
- evidence coverage;
- metric definition;
- median/range;
- exclusions;
- freshness;
- whether descriptive or predictive.

Never show a naked "reliability score".

## 22. Benchmark privacy

Cross-customer benchmarks must use privacy-safe aggregation.

Required:
- minimum cohort size;
- no exposure of another customer's asset identity;
- no reverse-identifiable property/provider detail;
- policy for provider/manufacturer reporting.

## 23. Repair vs Replace — purpose

Repair-vs-replace is a scenario comparison, not an automatic verdict.

Compare at least:

- immediate repair cost;
- replacement acquisition/install cost;
- expected near-term obligations;
- warranty state;
- downtime/disruption;
- known efficiency/operating-cost difference where sourced;
- remaining required service;
- parts availability;
- compliance/recall constraints;
- evidence uncertainty.

## 24. Repair vs Replace — hard exclusions

Replacement may be mandatory/strongly constrained by:
- confirmed recall remedy;
- regulatory prohibition;
- end-of-support rule;
- unavailable critical part;
- failed safety/inspection requirement;
- manufacturer instruction.

Renova must preserve source wording and authority.

## 25. Repair scenario

A repair scenario records:
- repair scope;
- sourced quote/range;
- required parts;
- provider qualification;
- expected downtime range;
- resulting warranty status if known;
- next mandatory maintenance;
- unresolved lifecycle risks;
- assumptions.

## 26. Replace scenario

A replacement scenario records:
- candidate approved replacement;
- acquisition cost;
- installation/commissioning cost;
- removal/disposal cost where known;
- expected lead time;
- warranty;
- maintenance obligations;
- compatibility/approval state;
- resulting asset identity;
- assumptions.

## 27. Scenario horizon

Repair-vs-replace comparisons require an explicit horizon, e.g.:
- 12 months;
- 36 months;
- 60 months;
- owner-selected.

Do not compare one-year repair cost with ten-year replacement cost without normalisation.

## 28. Lifecycle Cost Forecast

Forecast categories may include:
- scheduled maintenance;
- known repairs;
- probable corrective spend;
- consumables;
- replacement;
- service callouts;
- downtime proxy where defined.

Layer 1 forecast should include only deterministic/approved future obligations.

Probabilistic spend enters only after predictive qualification.

## 29. Total Cost of Ownership boundary

A lifecycle/TCO view must explicitly define included/excluded components.

Possible inclusions:
- acquisition;
- installation;
- maintenance;
- repairs;
- parts;
- energy/operating cost where connected;
- downtime proxy;
- replacement/disposal.

Do not label a partial cost view "TCO" unless coverage is stated prominently.

## 30. Preventive Intervention Window

Initially derive windows only from deterministic rules:
- manufacturer maintenance schedule;
- inspection interval;
- warranty condition;
- recall remedy;
- observed degradation threshold from authoritative telemetry where defined.

Later predictive windows may use validated reliability models.

The UI must distinguish "required by source" from "predicted advantageous window".

## 31. Portfolio Replacement Plan

A portfolio replacement plan coordinates known/approved future replacement demand.

Inputs:
- asset age/history;
- mandatory replacement rules;
- approved repair-vs-replace decisions;
- parts/end-of-support;
- target dates;
- budget constraints;
- provider capacity;
- access/disruption constraints.

Output:
- proposed replacement waves;
- critical replacements;
- optional candidates;
- CapEx timing;
- dependencies;
- unresolved evidence gaps.

No automatic procurement.

## 32. CapEx Forecast

CapEx forecasting must keep layers separate:

### Committed CapEx
approved/ordered commitments.

### Deterministic planned CapEx
known required replacements with sourced estimates.

### Scenario CapEx
what-if replacement strategies.

### Predictive CapEx
model-derived future replacement demand, only after validation.

Total charts must preserve this decomposition.

## 33. Budget scenario examples

Support:
- fixed annual budget;
- minimise urgent replacements;
- smooth CapEx by quarter/year;
- accelerate end-of-support assets;
- prioritise transfer-critical portfolio;
- preserve warranties;
- minimise downtime.

Hard constraints remain above budget optimisation.

## 34. Replacement backlog

Portfolio view may classify:
- mandatory overdue;
- mandatory upcoming;
- approved scheduled;
- candidate economic replacement;
- candidate reliability-driven replacement;
- insufficient evidence.

Do not collapse these into one backlog severity score.

## 35. Predictive reliability admission gate

Predictive models are not allowed into decision surfaces until:

- event taxonomy is stable;
- asset identity quality is sufficient;
- observation period is sufficient;
- censoring/exposure is handled;
- train/test split avoids leakage;
- calibration is measured;
- model performance beats a simple baseline;
- subgroup/cohort stability is checked;
- drift monitoring exists;
- explanations/limitations are documented;
- deterministic obligations still take precedence.

## 36. Predictive targets

Potential future targets:
- probability of corrective service within N days;
- probability of major repair within horizon;
- expected downtime band;
- probability part replacement is needed;
- expected replacement window.

Avoid predicting vague "asset health" scores unless tied to a measurable event.

## 37. Model validation

At minimum measure:
- discrimination where relevant;
- calibration;
- precision/recall at operational thresholds;
- false-positive burden;
- false-negative burden;
- lead-time usefulness;
- coverage;
- cohort stability;
- drift.

A high AUC alone is insufficient.

## 38. Prediction labels

UI states:

- source-required;
- statistically observed;
- predicted;
- insufficient data.

Predicted outputs must expose:
- model/version;
- horizon;
- confidence/probability/range;
- main source features at a safe explanatory level;
- data freshness;
- limitations.

## 39. No causal overclaim

Historical association must not be presented as cause.

Example:
"assets in cohort X had higher repair frequency" is acceptable.

"installer Y causes failures" requires much stronger causal evidence and governance.

## 40. Provider/manufacturer fairness

Benchmarks involving providers/manufacturers must control for:
- asset mix;
- observation period;
- maintenance regime;
- geography/use conditions;
- evidence quality;
- case severity.

Avoid public league tables from biased/insufficient data.

## 41. Lifecycle confidence profile

Instead of a single confidence score, expose:
- identity confidence/coverage;
- history coverage;
- cost coverage;
- failure-classification coverage;
- cohort comparability;
- forecast maturity.

## 42. Explainable decision package

Repair/replace or CapEx recommendation package should include:

- current asset facts;
- source-backed obligations;
- historical costs;
- service/failure timeline;
- comparable cohort stats;
- scenario assumptions;
- repair scenario;
- replace scenario;
- budget/time implications;
- uncertainties;
- approvals required.

## 43. Human approval boundary

Lifecycle Intelligence may:
- prepare comparison;
- propose replacement candidate;
- draft budget request;
- surface warranty-risk evidence gap;
- propose preventive timing.

It may not:
- approve CapEx;
- select vendor contractually;
- order equipment;
- waive warranty/inspection;
- decommission asset;
- write accounting journal entries.

## 44. Event-driven refresh

Recompute affected lifecycle views when:
- service/repair completes;
- cost reconciles;
- downtime closes;
- warranty changes;
- asset identity corrected;
- part/component replaced;
- recall changes;
- new cohort eligibility data arrives;
- approved replacement plan changes.

Avoid full portfolio recompute for unrelated changes.

## 45. Snapshot reproducibility

Every material comparison/forecast should store:
- asset snapshot;
- event cutoff;
- cost cutoff;
- cohort definition/version;
- cohort sample/exposure;
- policy version;
- model/rule version;
- scenario horizon;
- assumptions;
- generated_at.

## 46. Metrics for the feature itself

Measure:

### Decision coverage
`assets_with_sufficient_lifecycle_data / assets_in_scope`

### Cost coverage
`reconciled_asset_cost / known_total_relevant_cost` where denominator is meaningful.

### Repair-vs-replace follow-through
approved decisions resulting in canonical action.

### Forecast error
difference between planned/predicted and realised cost/demand, segmented by maturity layer.

### Preventive intervention precision
for predictive layer only: proposed windows that preceded real/avoided target events under a defined evaluation design.

### Replacement-plan adherence
approved replacements executed within planned window.

## 47. Pilot design

Start with one asset family that has:
- stable identity;
- repeated population;
- known maintenance intervals;
- meaningful repair history;
- reconciled costs;
- replacement events;
- limited model/variant heterogeneity.

Pilot steps:
1. deterministic ledger;
2. coverage audit;
3. cohort descriptive statistics;
4. repair-vs-replace scenario UI;
5. CapEx wave planning;
6. only then offline predictive backtesting.

## 48. Backtesting requirement

Before live predictive recommendations:
- freeze historical cutoff;
- generate prediction from only data available at that time;
- compare with subsequent observed events;
- measure operational usefulness;
- compare against deterministic/simple baseline.

Never backtest with future leakage.

## 49. Commercial packaging

### Property Care
- lifecycle history;
- repair cost history;
- maintenance/warranty continuity;
- repair-vs-replace package.

### Property Trust / Transfer
- lifecycle evidence;
- current warranty/service continuity;
- replacement history.

### Enterprise Asset Management
- cohort benchmarks;
- replacement backlog;
- CapEx scenarios;
- portfolio lifecycle economics.

### Manufacturer / Provider Insights
Potential later module only under privacy-safe aggregated policies and sufficient cohort quality.

## 50. Strategic moat

The moat is the joined verified lifecycle dataset:

```
exact installed asset
+ installation context
+ admitted service/failure history
+ actual cost
+ downtime
+ parts/replacement
+ provider evidence
+ warranty/recall state
+ maintenance compliance
+ cohort exposure
+ eventual property outcome
```

This can become substantially more valuable than generic predictive-maintenance telemetry because decisions remain traceable to asset identity, real costs and admitted evidence.

## 51. Anti-patterns — REJECT

- universal "asset health score";
- predicted failure shown as fact;
- repair-vs-replace without explicit horizon;
- benchmark without cohort/sample/exposure;
- survivorship-biased lifespan claims;
- quote mixed with actual cost;
- undocumented shared-cost allocation;
- theoretical warranty coverage called savings;
- AI-confirmed root cause;
- manufacturer/provider ranking from uncontrolled cohorts;
- CapEx forecast mixing committed and speculative demand;
- predictive model deployed before backtesting and calibration;
- automatic replacement/procurement.

## 52. Definition of Done — Layer 1

Deterministic lifecycle accounting is complete only when:
- stable asset identity exists;
- lifecycle event ledger is reproducible;
- maintenance/repair/replacement are distinct;
- reconciled actual costs are separated from quotes/budgets;
- shared-cost allocation is explicit;
- downtime semantics are explicit;
- warranty-paid vs owner-paid amounts are distinguishable;
- history/evidence gaps remain visible.

## 53. Definition of Done — Layer 2

Cohort intelligence is complete only when:
- cohort definition is reproducible;
- eligibility and exclusions are visible;
- minimum sample rules exist;
- exposure denominator is correct;
- censoring/survivorship is addressed;
- benchmark includes coverage and observation period;
- privacy thresholds prevent reverse identification.

## 54. Definition of Done — Layer 3

Predictive reliability is complete only when:
- historical backtest exists;
- leakage is excluded;
- calibration and operational thresholds are measured;
- simple baseline comparison exists;
- drift monitoring exists;
- limitations are visible;
- predictions cannot override mandatory source-backed obligations;
- human/canonical approval remains required for intervention/replacement.

## 55. Strict sequencing

1. lifecycle identity + event ledger;
2. deterministic lifecycle accounting;
3. cost attribution/reconciliation;
4. warranty/downtime semantics;
5. cohort eligibility + exposure model;
6. descriptive reliability benchmarks;
7. Repair vs Replace scenarios;
8. deterministic Lifecycle Cost / CapEx planning;
9. historical backtesting;
10. predictive reliability pilot;
11. live predictive assistance only after validation.
