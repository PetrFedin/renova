# Renova — Capital Planning & Asset Strategy Engine Contract

**Date:** 2026-10-08  
**Status:** RESEARCH / LONG-HORIZON CAPITAL STRATEGY CONTRACT  
**Implementation gate:** after deterministic Lifecycle Intelligence, Operations Network capacity/lead-time foundations, and sufficient reconciled cost history.  
**Depends on:** Property Lifecycle Intelligence, Property Operations Network, Intervention Optimizer, Property Trust/Transfer profiles, canonical Budget/Procurement/Service/Project domains.  
**Authority rule:** Capital Strategy is planning and decision support. It does not become accounting ledger, treasury, lender underwriting engine, valuation authority, procurement authority, or board approval authority.

## 1. Purpose

Property Lifecycle Intelligence explains asset history, cohort behaviour and repair/replacement economics.

Capital Planning & Asset Strategy converts that evidence into long-horizon portfolio decisions:

```
verified lifecycle history
-> mandatory and likely capital needs
-> 5/10-year capital demand
-> replacement waves
-> budget constraints
-> procurement lead times
-> provider capacity
-> disruption windows
-> financing scenarios
-> transfer/refinancing targets
-> approved capital programme
-> execution
-> actual vs plan
-> strategy refresh
```

The core product question is:

`Given what is known about the portfolio and its assets, what capital programme is feasible, evidence-supported and strategically preferable under explicit constraints?`

## 2. Capital plan horizons

Support explicit planning horizons such as:

- current fiscal year;
- 24 months;
- 3 years;
- 5 years;
- 10 years;
- custom horizon.

Each plan stores:

- start date;
- end date;
- fiscal/calendar basis;
- currency;
- tax/VAT convention;
- nominal vs real-price convention;
- inflation/indexation policy;
- scenario version.

Do not compare plans with different conventions without normalization.

## 3. CapEx state taxonomy

Every capital item must be one of:

- observed historical actual;
- committed;
- approved;
- deterministic planned;
- scenario candidate;
- predictive candidate;
- excluded/deferred;
- unknown/insufficient evidence.

These states must remain distinct in UI and calculations.

## 4. Capital demand sources

Demand may originate from:

- mandatory lifecycle replacement;
- approved repair-vs-replace decision;
- end-of-support/end-of-life source;
- regulatory/inspection requirement;
- official recall;
- warranty expiry strategy;
- transfer/refinancing readiness;
- business continuity requirement;
- energy/operating-cost initiative with approved business case;
- owner strategic programme;
- scenario-only modernization;
- predictive reliability candidate after model qualification.

Source type must always be visible.

## 5. Capital item identity

Each planned capital item references:

- property;
- asset/system;
- lifecycle evidence;
- demand source;
- earliest feasible window;
- latest required/target window;
- criticality;
- replacement/upgrade scope;
- estimated cost source;
- procurement lead time;
- provider capacity requirement;
- disruption class;
- dependencies;
- funding/approval state;
- linked target profile where relevant.

## 6. Mandatory vs discretionary capital

### Mandatory
Examples:

- source-required replacement;
- legal/regulatory requirement;
- confirmed recall remedy;
- end-of-support with no maintainable path;
- approved critical failure remediation;
- contractual transfer/refinancing prerequisite.

### Discretionary
Examples:

- modernization;
- aesthetic refresh;
- energy-efficiency upgrade;
- lifecycle-economic replacement before hard failure;
- experience improvement.

A budget optimiser cannot defer mandatory critical work merely to preserve discretionary spend.

## 7. Portfolio criticality

Criticality must derive from explicit operational impact dimensions, not an opaque score.

Candidate dimensions:

- life/safety or official recall status;
- statutory/contract deadline;
- business continuity impact;
- number of dependent rooms/units;
- revenue-generating area impact;
- tenant/customer disruption;
- redundancy availability;
- transfer/refinancing blocker;
- serviceability/parts risk;
- owner strategic importance.

Expose dimensions separately.

## 8. Criticality policy profiles

Different portfolios may define governed profiles:

- residential;
- hotel;
- retail;
- office;
- logistics;
- mixed-use;
- premium/luxury;
- developer handover/defects;
- property management.

Profiles define weighting/precedence only where approved and transparent.

Mandatory safety/regulatory constraints remain hard constraints.

## 9. 5/10-year CapEx plan

A long-horizon plan should contain:

- committed capital;
- approved planned capital;
- deterministic future obligations;
- scenario candidates;
- predictive candidates separately;
- annual/quarterly phasing;
- inflation/indexation;
- contingency policy;
- procurement timing;
- capacity constraints;
- disruption windows;
- funding assumptions;
- unresolved evidence gaps.

Never show one total without decomposition.

## 10. Replacement waves

Group replacement candidates into waves when this reduces operational or procurement friction.

Possible grouping dimensions:

- asset type/model;
- property/geography;
- supplier/manufacturer;
- service provider capability;
- building shutdown window;
- tenant turnover window;
- seasonal downtime;
- warranty/end-of-support date;
- procurement batch opportunity.

Wave grouping does not erase individual asset justification.

## 11. Wave eligibility

A capital wave is valid only when:

- each included asset has explicit inclusion reason;
- hard timing constraints are compatible;
- procurement compatibility is confirmed;
- provider capacity exists or risk is flagged;
- disruption window is feasible;
- individual approvals remain traceable;
- replacement evidence can be recorded asset-by-asset.

## 12. Budget constraints

Supported constraints may include:

- annual CapEx ceiling;
- quarterly ceiling;
- project/property ceiling;
- asset-class envelope;
- mandatory reserve;
- funding tranche;
- board-approved programme envelope;
- currency exposure limit where applicable;
- minimum contingency.

Budget constraints are scenario inputs, not silent assumptions.

## 13. Budget infeasibility

If mandatory demand exceeds budget:

- do not hide or defer it automatically;
- show shortfall;
- identify mandatory amount;
- show which items are unfunded;
- show earliest/latest windows;
- expose operational consequences;
- propose governed escalation/funding scenarios.

## 14. Inflation and indexation

Cost escalation may use:

- contract index;
- supplier indexation;
- official inflation index;
- commodity/material index;
- owner planning assumption.

Each indexed forecast stores:

- base amount/date;
- index source;
- index date/version;
- formula;
- nominal/real semantics;
- uncertainty range if applicable.

Do not apply generic CPI silently to specialist equipment when another governed basis is required.

## 15. FX handling

For multi-currency capital:

- source currency;
- reporting currency;
- FX rate source;
- FX date;
- hedged/unhedged status where known;
- scenario FX assumption.

Historical actuals retain transaction/reconciled accounting values.

Scenario FX must not overwrite accounting actuals.

## 16. Procurement lead-time model

Lead time may include:

- design/specification;
- approval;
- tender/RFQ;
- manufacture;
- import/customs;
- delivery;
- site preparation;
- installation;
- commissioning.

Each component can be sourced, historical, or scenario-estimated.

Unknown lead time remains unknown.

## 17. Long-lead risk

Surface:

- procurement must start before budget year;
- part/equipment availability risk;
- sole-source dependency;
- manufacturer end-of-support;
- import/logistics uncertainty;
- commissioning capacity conflict.

A capital plan that ignores long lead times is infeasible.

## 18. Contractor capacity

Capital planning consumes Operations Network capacity:

- trade capability;
- certification;
- manufacturer authorisation;
- crew capacity;
- regional availability;
- seasonal constraints;
- committed workload;
- commissioning capability.

Capacity is a feasibility constraint, not decorative context.

## 19. Procurement capacity

Where relevant, also model:

- supplier capacity;
- production slots;
- batch minimums;
- framework allocation;
- warehouse/storage constraints;
- installation sequence.

## 20. Tenant / business disruption

Capital items may carry disruption attributes:

- room/unit unavailable;
- trading area unavailable;
- hotel room out of inventory;
- office floor shutdown;
- noise/dust;
- utility interruption;
- customer access impact;
- overnight/weekend requirement.

Disruption must be treated as a real planning dimension.

## 21. Disruption cost/proxy

Where the organisation has a defined model, scenario planning may include:

- lost room revenue;
- lost retail trading hours;
- temporary relocation cost;
- business interruption proxy;
- customer compensation;
- overtime/night-work premium.

These values require an explicit source/model.

Unknown disruption value is not zero.

## 22. Business calendar integration

Capital plans may respect:

- hotel occupancy peaks;
- retail campaigns/holiday periods;
- tenant lease events;
- office occupancy;
- school/medical operating periods;
- planned shutdowns;
- developer handover milestones.

Calendar constraints must be sourced or user-entered and versioned.

## 23. Financing scenarios

Financing is a scenario layer, not credit underwriting.

Possible structures:

- cash-funded;
- reserve-funded;
- staged internal budget;
- lease/asset finance;
- debt facility;
- landlord/tenant contribution;
- insurance recovery;
- vendor financing.

Renova may compare cash-flow profiles if terms are explicitly entered/sourced.

It must not infer lender approval or financing eligibility.

## 24. Financing fields

A financing scenario may include:

- principal;
- draw dates;
- term;
- interest/reference rate;
- fees;
- grace period;
- repayment profile;
- currency;
- security/conditions only if provided;
- source/assumption.

Outputs remain planning calculations.

## 25. NPV / discounted cash-flow scenarios

Optional financial comparison may use:

- discount rate;
- horizon;
- cash flows;
- residual value if sourced;
- inflation convention.

The discount rate must be explicit.

Do not present NPV as property valuation.

## 26. Repair / replace / defer strategy

Capital Strategy may compare:

- repair now;
- replace now;
- repair then replace later;
- defer within permissible window;
- batch into future wave.

Each option must include:

- lifecycle evidence;
- mandatory constraints;
- costs;
- capacity;
- disruption;
- residual risks;
- future maintenance;
- scenario horizon.

## 27. Deferral semantics

Deferral is only valid when:

- hard deadline permits it;
- safety/regulatory policy permits it;
- warranty implications are understood;
- resulting operational risk is explicit;
- owner/authorised actor approves.

"Budget unavailable" cannot silently transform mandatory work into optional work.

## 28. Transfer / refinancing targets

A property may have strategic target dates such as:

- sale;
- transfer;
- refinancing;
- insurer review;
- lender diligence;
- lease event;
- handover.

Capital plan may identify:

- required evidence;
- blockers;
- capital works needed before target;
- long-lead dependencies;
- earliest feasible readiness;
- unresolved uncertainty.

Renova must not claim lender/insurer approval.

## 29. Capital readiness path

Example:

```
refinancing target
-> purpose-specific requirements
-> lifecycle/trust gaps
-> required capital interventions
-> procurement/capacity constraints
-> approved works
-> evidence
-> profile recompute
-> bounded verification artifact
```

## 30. Scenario engine

Support explicit scenarios such as:

- Base;
- Mandatory-only;
- Budget constrained;
- Reliability accelerated;
- Transfer/refinancing accelerated;
- Minimal disruption;
- Procurement-risk reduced;
- Energy modernization;
- High-inflation;
- FX stress;
- Capacity shortage.

Scenario names and assumptions must be inspectable.

## 31. Scenario comparison

Compare:

- total nominal CapEx;
- total real CapEx if applicable;
- mandatory funded/unfunded amount;
- annual/quarterly cash flow;
- number of replacements;
- critical backlog remaining;
- target-profile readiness timing;
- procurement risk;
- contractor capacity risk;
- disruption days/proxy;
- evidence gaps;
- contingency use.

No single hidden "optimal strategy score".

## 32. Hard constraints before optimization

Hard constraints may include:

- safety/recall;
- statutory deadline;
- contractual deadline;
- approved blackout;
- financing/funding availability;
- procurement lead time;
- qualified provider availability;
- technical compatibility;
- shutdown sequence;
- dependency completion.

An optimiser cannot trade these for lower CapEx.

## 33. Objective profiles

After hard constraints, optimize explicit objectives such as:

- minimise capital peak;
- smooth annual spend;
- minimise lifecycle cost;
- minimise operational disruption;
- maximise mandatory backlog reduction;
- accelerate target-property readiness;
- reduce provider/supplier concentration;
- preserve optionality;
- maximise evidence-backed reliability benefit.

## 34. Capital programme approval boundary

Renova may:

- prepare programme;
- compare scenarios;
- propose waves;
- generate approval package;
- identify unfunded mandatory demand;
- draft RFQ/procurement intents.

Renova may not:

- approve board budget;
- commit financing;
- execute treasury transfer;
- sign vendor contract;
- place binding purchase order without authorised workflow;
- post accounting journal;
- determine property valuation.

## 35. Approval lineage

Every approved plan/programme stores:

- approving actor/body;
- plan version;
- approved amount;
- horizon;
- assumptions;
- included/excluded items;
- contingency;
- effective date;
- superseded plan link.

Later actual-vs-plan must compare against the exact approved baseline.

## 36. Baseline freeze

When a programme is approved:

- freeze baseline snapshot;
- preserve original timing/cost/assumptions;
- subsequent changes create forecast/current-plan versions;
- do not rewrite history.

This enables true variance analysis.

## 37. Actual vs plan capital performance

Measure by capital item, wave, property and portfolio:

- approved budget;
- committed amount;
- actual/reconciled spend;
- schedule baseline;
- actual completion;
- scope changes;
- contingency draw;
- procurement variance;
- capacity delay;
- FX/indexation variance.

## 38. Cost variance

Candidate decomposition:

`actual - approved baseline = scope variance + price/index variance + FX variance + quantity variance + execution variance + allocation/unclassified variance`

Only calculate components supported by available data.

## 39. Schedule variance

Track:

- baseline procurement start;
- planned award/order;
- planned delivery;
- planned installation;
- planned commissioning;
- actual milestones.

Do not reduce schedule performance to one opaque percentage if milestone evidence is incomplete.

## 40. Scope variance

Classify capital change as:

- added scope;
- removed scope;
- specification change;
- quantity change;
- substitution;
- unforeseen condition;
- compliance requirement;
- owner decision;
- error/correction.

Classification requires source/approval lineage.

## 41. Contingency governance

Contingency is not free budget.

Track:

- original contingency;
- reserved;
- approved draw;
- released;
- remaining;
- reason;
- approver;
- linked risk/change.

## 42. Capital backlog

Separate:

- mandatory overdue;
- mandatory within horizon;
- approved scheduled;
- unfunded mandatory;
- discretionary approved;
- scenario candidate;
- predictive candidate;
- insufficient evidence.

This is more useful than one "backlog score".

## 43. Portfolio heatmap

A portfolio view may expose dimensions such as:

- mandatory CapEx by year;
- unfunded mandatory amount;
- long-lead exposure;
- disruption exposure;
- provider capacity shortage;
- transfer/refinancing blockers;
- evidence coverage.

Heatmap cells must drill to underlying items.

## 44. Capital confidence profile

Expose separate coverage:

- asset identity coverage;
- lifecycle-history coverage;
- cost-estimate coverage;
- procurement lead-time coverage;
- provider-capacity coverage;
- disruption-model coverage;
- financing assumption coverage;
- predictive-model maturity.

Never collapse into one confidence number.

## 45. Forecast maturity labels

Capital values should be labelled:

- reconciled actual;
- committed;
- approved;
- sourced estimate;
- indexed estimate;
- scenario estimate;
- predictive estimate;
- unknown.

## 46. Monte Carlo / stochastic scenarios

Possible later capability for uncertain:

- price inflation;
- FX;
- lead time;
- failure timing;
- schedule duration.

Only adopt when:

- input distributions are defensible;
- users understand ranges;
- outputs are decision-useful;
- deterministic baseline remains visible.

Do not add simulation merely for sophistication.

## 47. Stress testing

Useful deterministic stress scenarios may include:

- +10% / +20% equipment inflation;
- FX shock;
- one-quarter supplier delay;
- 25% capacity reduction;
- financing cost increase;
- peak-season blackout;
- recall surge.

Stress inputs must be explicit.

## 48. Procurement strategy analytics

Potential decision support:

- batch vs staggered buying;
- single vs multi-supplier exposure;
- framework agreement coverage;
- long-lead pre-order timing;
- standardisation opportunities;
- spare strategy.

No automated tender award.

## 49. Standardisation opportunities

Lifecycle cohorts may reveal that portfolio complexity itself creates cost.

Candidate analysis:

- too many models for same function;
- fragmented spare parts;
- fragmented provider qualifications;
- inconsistent maintenance regimes;
- low-volume legacy systems.

Renova may propose a standardisation study, not automatically select a vendor/model.

## 50. Asset strategy archetypes

A capital item may be categorised for planning as:

- maintain;
- repair;
- refurbish;
- replace;
- consolidate;
- standardise;
- retire/decommission;
- investigate.

This is a strategy label, not execution state.

## 51. Decommissioning

If decommission is considered, plan may include:

- dependency impact;
- replacement/alternative service;
- shutdown;
- regulatory/disposal requirements;
- asset history closure;
- evidence archive.

No silent deletion of retired assets.

## 52. Data sources

Potential sources:

- Renova lifecycle ledger;
- reconciled invoices/cost data;
- procurement system;
- supplier quotes/catalogues;
- Operations Network capacity;
- routing/lead-time observations;
- official indices;
- financing terms entered by authorised user;
- property/tenant business calendar;
- Trust/Transfer requirements.

Each remains source-labelled.

## 53. Accounting boundary

Renova may reconcile operational planning values with accounting exports.

It must not become the general ledger unless explicitly built and governed as such.

Authoritative accounting figures remain in the accounting/ERP system where applicable.

## 54. Valuation boundary

Capital planning may expose cost, condition evidence and programme requirements.

It must not claim:

- property market value;
- appraisal;
- collateral value;
- lender valuation;
- investment recommendation.

These require separate authority/professional processes.

## 55. Financing boundary

Renova may calculate scenarios from provided terms.

It must not:

- recommend regulated financial products as personalised advice;
- infer creditworthiness;
- claim financing approval;
- optimise around hidden sensitive/protected characteristics.

## 56. Security and ACL

Capital data may be more sensitive than ordinary service data.

Require:

- role-based cost visibility;
- financing-term visibility controls;
- board/owner approval scopes;
- provider separation from portfolio budgets;
- audit of plan approvals/changes;
- export controls where necessary.

## 57. Multi-entity portfolios

Support:

- owner entity;
- asset-holding SPV;
- management company;
- operator;
- tenant;
- project entity.

Capital responsibility must reference the correct legal/operational entity where provided.

Do not infer liability from operational ownership.

## 58. Cross-property dependencies

Examples:

- shared plant;
- central utility system;
- common procurement package;
- one shutdown affecting multiple units;
- single provider crew;
- portfolio-wide recall.

Represent dependencies explicitly.

## 59. Evidence package for capital approval

Each major item/wave may package:

- asset history;
- current condition/evidence;
- mandatory source;
- lifecycle cost;
- repair-vs-replace comparison;
- quotes;
- lead times;
- capacity;
- disruption;
- funding scenario;
- risks;
- approval trail.

This is a board/owner decision packet, not merely a dashboard card.

## 60. Decision Ledger integration

Approved capital decisions should create/reference canonical Decision Ledger entries:

- decision;
- alternatives considered;
- evidence snapshot;
- assumptions;
- approver;
- expiry/review trigger;
- supersession.

## 61. Replan triggers

Replan affected items when:

- cost estimate changes materially;
- supplier quote expires;
- lead time changes;
- provider capacity changes;
- financing assumption changes;
- asset failure occurs;
- recall appears;
- repair-vs-replace decision changes;
- target transfer/refinancing date changes;
- actual spend posts;
- scope changes.

## 62. Plan stability

Avoid unnecessary programme churn.

Rules:

- preserve approved items unless material trigger exists;
- preserve binding procurement commitments;
- explain every material movement across fiscal periods;
- show old vs new baseline;
- do not reoptimise board-approved programme for marginal theoretical savings without review.

## 63. Metrics

### Mandatory funding coverage
`funded_mandatory_capex / total_mandatory_capex_in_horizon`

### Forecast accuracy
Segment by maturity class:
`forecast vs realised`

### Capital variance
`actual_reconciled - approved_baseline`

### On-time capital completion
`capital_items_completed_within_approved_window / completed_capital_items`

### Long-lead readiness
`items_with_procurement_started_by_required_date / long_lead_items_due`

### Contingency draw rate
`approved_contingency_draw / original_contingency`

### Disruption variance
planned vs actual defined disruption.

### Replacement backlog age
age of unfunded/overdue mandatory replacements.

## 64. Commercial packaging

### Owner / Private Portfolio
- 5-year capital plan;
- repair/replace;
- replacement calendar;
- major-work approval packets.

### Property / Facility Manager
- annual programme;
- procurement/capacity planning;
- disruption calendar;
- variance tracking.

### Hotel / Retail / Office Operator
- revenue/occupancy-aware disruption planning;
- seasonal replacement waves;
- business-continuity priorities.

### Enterprise / Developer
- 5/10-year portfolio capital programme;
- funding gap;
- standardisation;
- procurement waves;
- actual-vs-plan performance;
- transfer/refinancing readiness.

## 65. Strategic moat

The strongest defensible layer is not a generic budgeting tool.

It is the traceable chain:

```
exact asset
+ lifecycle history
+ actual cost
+ reliability cohort
+ mandatory obligation
+ provider/supplier capacity
+ procurement lead time
+ disruption context
+ approved capital decision
+ actual outcome
```

That allows increasingly better capital strategy while preserving evidence lineage.

## 66. Anti-patterns — REJECT

- one blended CapEx number mixing committed and speculative demand;
- hidden priority score deciding capital allocation;
- defer mandatory work because budget optimiser prefers it;
- unsourced inflation/FX/lead-time assumptions;
- NPV presented as property valuation;
- financing scenario presented as lender approval;
- procurement route ignoring provider/supplier capacity;
- replacement wave bulk-closing asset obligations;
- actual-vs-plan baseline rewritten after approval;
- savings/ROI without explicit baseline;
- auto-award/auto-order/auto-finance;
- opaque AI deciding portfolio capital allocation.

## 67. Definition of Done — Foundation

Foundation is complete only when:

- CapEx states are distinct;
- mandatory/discretionary classification is sourced;
- long-horizon plan preserves annual/quarterly phasing;
- inflation/indexation assumptions are explicit;
- procurement lead time and provider capacity affect feasibility;
- disruption is represented;
- approval baseline can be frozen;
- actual/reconciled spend can be compared to baseline.

## 68. Definition of Done — Strategy

Strategy layer is complete only when:

- replacement waves preserve per-asset justification;
- budget shortfalls expose unfunded mandatory demand;
- financing scenarios remain non-authoritative;
- target transfer/refinancing dependencies are visible;
- scenario comparison exposes assumptions;
- plan stability/supersession works;
- variance decomposition is source-backed.

## 69. Definition of Done — Advanced

Advanced layer is complete only when:

- Lifecycle predictive candidates are separately labelled;
- stochastic simulation uses defensible distributions;
- historical forecast accuracy is measured;
- stress scenarios are reproducible;
- strategy recommendations remain reviewable and reversible;
- no model can commit budget, financing or procurement.

## 70. Strict sequencing

1. capital item/state model;
2. 5-year deterministic CapEx plan;
3. inflation/indexation + lead times;
4. provider/supplier capacity feasibility;
5. disruption calendar;
6. replacement waves;
7. approval baseline + actual-vs-plan;
8. funding-gap / financing scenarios;
9. 10-year strategy and standardisation;
10. stress testing;
11. stochastic/predictive capital scenarios only after validated history.
