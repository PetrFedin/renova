# Renova — Portfolio Strategy & Investment Committee OS Contract

**Date:** 2026-10-08  
**Status:** RESEARCH / OWNER & PORTFOLIO DECISION GOVERNANCE CONTRACT  
**Implementation gate:** after Capital Planning & Asset Strategy foundation, portfolio-level evidence coverage, and reliable actual-vs-plan history.  
**Depends on:** Capital Planning & Asset Strategy Engine, Property Lifecycle Intelligence, Property Operations Network, Property Trust/Transfer profiles, Decision Ledger, canonical finance/ERP exports where available.  
**Authority rule:** this layer prepares, compares and governs owner/committee decisions. It does not become a regulated investment adviser, property valuer, lender, treasury system, accounting ledger, or autonomous capital allocator.

## 1. Purpose

Capital Strategy answers:

`what capital programme is feasible for each property/asset under explicit constraints?`

Portfolio Strategy & Investment Committee OS answers:

`given portfolio objectives, asset conditions, operating performance, capital needs and constraints, what portfolio-level scenarios should the owner/committee consider, approve, monitor and later evaluate?`

Canonical chain:

```
portfolio objectives
-> property strategy posture
-> asset-level capital needs
-> lifecycle economics
-> occupancy / operating performance
-> transfer / refinancing targets
-> capital allocation constraints
-> scenario portfolios
-> committee decision package
-> approvals / conditions
-> execution programmes
-> evidence
-> outcome tracking
-> strategy review / supersession
```

## 2. Non-advisory boundary

Renova may support:
- evidence aggregation;
- scenario comparison;
- capital allocation planning;
- governance;
- decision documentation;
- execution tracking;
- outcome measurement.

Renova must not:
- tell a user to buy/sell securities;
- determine regulated investment suitability;
- issue formal property valuations/appraisals;
- claim expected investment returns without explicit sourced assumptions;
- infer financing approval;
- autonomously dispose/acquire assets;
- commit capital.

## 3. Portfolio entity model

A portfolio may include:
- properties;
- buildings;
- SPVs;
- operators;
- management entities;
- projects;
- development phases;
- strategic asset groups.

Every property/asset must preserve:
- legal/operational entity;
- owner;
- manager/operator;
- reporting currency;
- strategy status;
- data coverage.

## 4. Portfolio objectives

Objectives must be explicit, versioned and owner/committee approved.

Examples:
- preserve capital;
- reduce mandatory backlog;
- improve operating resilience;
- improve tenant/customer experience;
- prepare assets for sale;
- prepare assets for refinancing;
- reduce lifecycle cost;
- standardise systems;
- accelerate modernization;
- reduce disruption;
- improve evidence/transfer readiness.

Objectives are not hidden model weights.

## 5. Property strategy posture

Allowed strategic posture labels:

- hold;
- hold_and_maintain;
- improve;
- reposition;
- standardise;
- prepare_for_transfer;
- prepare_for_refinancing;
- dispose_candidate;
- investigate;
- constrained_hold.

These are strategic planning labels, not legal or transactional states.

## 6. Strategy posture evidence

Each posture should reference:
- owner objective;
- property/business role;
- lifecycle condition;
- mandatory capital needs;
- operating performance;
- occupancy/business context;
- transfer/refinancing target;
- major risks/constraints;
- evidence coverage;
- decision lineage.

No posture should exist only because an AI model assigned it.

## 7. Operating performance inputs

Possible source-backed inputs:
- occupancy;
- room inventory utilisation;
- retail trading performance;
- lease occupancy;
- downtime;
- service disruption;
- maintenance burden;
- operating cost;
- revenue or NOI-like operational measures if imported from authoritative systems;
- customer/tenant experience measures;
- vacancy/turnover events.

Renova must preserve source/system authority.

## 8. Financial performance boundary

If portfolio users provide financial metrics:
- label source;
- preserve period;
- preserve currency;
- distinguish actual vs forecast;
- distinguish audited/closed vs provisional where known.

Renova does not certify accounting accuracy.

## 9. Asset strategy fact pack

Every property strategy view may combine:

- current posture;
- asset/property identity;
- mandatory capital backlog;
- 5/10-year CapEx;
- lifecycle economics;
- major service/reliability issues;
- operations capacity constraints;
- disruption exposure;
- trust/transfer readiness;
- operating performance;
- financing/refinancing target;
- evidence gaps.

## 10. Hold / Improve / Reposition / Dispose semantics

### Hold
Continue current role with planned maintenance/capital.

### Improve
Target measurable operational or asset-quality improvement.

### Reposition
Change property role, product, tenant/customer proposition or operating model.

### Dispose candidate
Prepare evidence, capital cleanup and decision package for possible transfer.

No label itself triggers sale, procurement or redevelopment.

## 11. Capital allocation envelope

Portfolio committee may define:

- total capital ceiling;
- annual envelope;
- mandatory reserve;
- business-unit envelopes;
- debt-funded vs cash-funded assumptions;
- contingency;
- strategic initiative budgets;
- minimum liquidity/funding constraints if provided.

Constraints must be explicit.

## 12. Capital allocation precedence

Default precedence:

1. mandatory safety / official recall / statutory;
2. contractual or legal deadlines;
3. business continuity;
4. approved transfer/refinancing blockers;
5. committed capital;
6. approved strategic programmes;
7. lifecycle-economic improvements;
8. discretionary modernization.

Committee policy may refine, but cannot silently demote mandatory obligations.

## 13. Portfolio scenario

A scenario is a complete, reproducible portfolio strategy snapshot.

It includes:
- objective version;
- included properties;
- strategy posture per property;
- capital envelope;
- funding assumptions;
- timing horizon;
- asset programmes;
- exclusions;
- transfer/disposal/refinancing targets;
- major constraints;
- expected operational outcomes where source-supported;
- uncertainties.

## 14. Scenario types

Examples:

- Base Plan;
- Mandatory Protection;
- Growth / Improvement;
- Disposal Preparation;
- Refinance Readiness;
- Minimum Disruption;
- Capital Constrained;
- Standardisation;
- Reliability Accelerated;
- High Inflation;
- Capacity Shortage;
- FX Stress.

## 15. Scenario comparison

Compare transparent dimensions:

- mandatory CapEx funded;
- unfunded mandatory demand;
- committed/approved/scenario CapEx;
- annual capital peak;
- backlog after horizon;
- number of properties improved/repositioned/transfer-ready;
- disruption exposure;
- provider/supplier capacity risk;
- long-lead exposure;
- transfer/refinancing readiness;
- operating-performance assumptions;
- evidence coverage;
- scenario uncertainty.

No universal "portfolio strategy score".

## 16. Capital allocation optimization

Optimizer may suggest feasible allocations after hard constraints.

Explicit objective profiles may include:
- maximise mandatory backlog reduction;
- minimise annual capital peak;
- accelerate target-property readiness;
- minimise disruption;
- prioritise standardisation;
- minimise lifecycle cost;
- preserve liquidity envelope;
- maximise evidence-backed operational benefit.

Every proposed allocation must expose objective and constraints.

## 17. Allocation explainability

For every included/excluded item, provide:

- why included;
- why deferred;
- mandatory/discretionary;
- constraint that affected decision;
- alternative considered;
- expected effect;
- uncertainty.

No property should lose funding due to a hidden black-box rank.

## 18. Scarce-capital policy

If mandatory demand exceeds capital:

- expose gap;
- identify which obligations remain unfunded;
- identify deadline and consequence;
- generate escalation scenarios;
- preserve committee responsibility.

The engine cannot pretend all mandatory work is covered.

## 19. Portfolio dependency graph

Represent cross-property dependencies:

- shared plant;
- same procurement package;
- same shutdown window;
- same contractor crew;
- same supplier capacity;
- portfolio-wide recall;
- common refinancing programme;
- coordinated sale process.

## 20. Programmes

Portfolio programmes may group:
- HVAC replacement;
- façade;
- elevators;
- fire/life-safety systems;
- room refurbishment;
- retail refresh;
- standardisation;
- compliance;
- sustainability/energy initiatives;
- transfer readiness.

Each programme preserves property/asset-level justification.

## 21. Investment Committee Decision Pack

A committee pack should be generated from evidence, not manually reconstructed each cycle.

Sections may include:
- executive summary;
- decision requested;
- portfolio objective;
- current approved baseline;
- scenario options;
- mandatory obligations;
- capital allocation;
- property-level changes;
- major risks;
- disruption/capacity;
- financing assumptions;
- evidence coverage;
- unresolved questions;
- recommendation rationale;
- required approvals;
- exact source links.

## 22. Decision request types

Examples:
- approve capital envelope;
- approve programme;
- approve property posture change;
- approve repair vs replace;
- approve transfer-preparation budget;
- approve refinancing-readiness works;
- approve exception/deferral;
- approve contingency draw;
- approve strategy supersession.

## 23. Committee meeting versioning

Every committee cycle stores:
- meeting/decision ID;
- pack version;
- data cutoff;
- scenario version;
- attendees/roles where provided;
- agenda item;
- proposed decision;
- decision result;
- conditions;
- dissent/abstention if recorded;
- follow-up actions;
- superseded decision links.

## 24. Decision Ledger integration

Approved committee outcomes must reference canonical Decision Ledger entries.

Required:
- exact decision text;
- scope;
- approved amount;
- conditions;
- effective date;
- evidence snapshot;
- assumptions;
- approver/committee;
- expiry/review trigger;
- supersession.

## 25. Conditional approval

Support:
- approved;
- approved_with_conditions;
- deferred;
- rejected;
- more_information_required;
- superseded.

Conditions must be machine-readable where possible and visible in execution tracking.

## 26. Conflict of interest

If committee/member conflict is recorded:
- capture actor;
- affected item;
- disclosure;
- recusal;
- decision impact.

Renova does not infer conflicts automatically from private data unless governed source exists.

## 27. Quorum / approval policy

Organisations may define:
- quorum;
- voting threshold;
- required roles;
- reserved matters;
- amount thresholds;
- dual approval.

Renova can enforce workflow policy where configured.

It does not decide corporate law validity.

## 28. Delegated authority

Approval limits may depend on:
- amount;
- property;
- programme;
- legal entity;
- decision type.

A manager cannot approve beyond configured authority.

## 29. Committee pack integrity

Every pack should expose:
- data cutoff;
- stale sources;
- missing evidence;
- scenario assumptions;
- changes since prior pack;
- unresolved blockers.

Do not show a polished "green" pack when coverage is incomplete.

## 30. Change since last committee

Highlight:

- new mandatory obligation;
- new failure/recall;
- cost increase;
- schedule slip;
- capacity/lead-time change;
- funding change;
- scope change;
- transfer/refinancing target change;
- actual outcome;
- newly resolved evidence gap.

## 31. Decision deltas

When a new strategy replaces an old one, show:

- properties whose posture changed;
- capital moved;
- programmes added/removed;
- timing moved;
- assumptions changed;
- reason;
- impact.

## 32. Disposal preparation

For a disposal candidate, the system may coordinate:

- transfer dossier readiness;
- unresolved maintenance/recall;
- capital cleanup options;
- document/evidence gaps;
- lifecycle history;
- approved disclosure package;
- target date;
- cost to readiness.

It must not value the property or recommend a sale price.

## 33. Hold strategy

For hold assets:
- mandatory maintenance;
- lifecycle optimisation;
- replacement programme;
- resilience;
- standardisation;
- long-horizon CapEx.

## 34. Improve strategy

Improvement may target:
- reliability;
- operating cost;
- service level;
- tenant/customer experience;
- evidence quality;
- asset standardisation.

Expected outcomes must be tied to measurable KPIs and assumptions.

## 35. Reposition strategy

Reposition may require:
- new business/operating objective;
- substantial CapEx;
- downtime;
- approvals;
- procurement;
- new asset standards;
- transfer/refinancing implications.

Renova plans/governs; it does not determine market feasibility autonomously.

## 36. Outcome hypotheses

Every discretionary strategic programme should state:
- expected outcome;
- metric;
- baseline;
- target;
- horizon;
- assumptions;
- measurement source.

Example:
"Reduce corrective HVAC service events per 100 asset-months over 24 months."

Avoid vague "increase asset value" unless an authoritative valuation process supplies a metric.

## 37. Outcome tracking

Post-approval measure:

- spend;
- schedule;
- mandatory backlog reduction;
- service/reliability outcome;
- downtime;
- operating cost;
- occupancy/business metric if provided;
- transfer/refinancing readiness;
- evidence completeness.

## 38. Outcome attribution

Do not claim strategy caused an outcome unless causal design supports it.

Use:
- before/after;
- controlled comparison where available;
- descriptive association;
- hypothesis status.

## 39. Strategy review triggers

Review strategy when:
- major failure/recall;
- capital envelope change;
- financing/refinancing event;
- property disposition target;
- material operating-performance change;
- tenant/operator change;
- regulatory change;
- provider/supplier capacity shock;
- major inflation/FX shock;
- committee-specified review date.

## 40. Strategy cadence

Support:
- monthly exception review;
- quarterly portfolio review;
- annual strategy cycle;
- ad hoc event-driven review.

Cadence is configurable.

## 41. Portfolio KPI hierarchy

Do not overload with dashboard metrics.

Suggested hierarchy:

### Governance
- decisions pending;
- conditions outstanding;
- approvals overdue.

### Capital
- mandatory funded/unfunded;
- committed/actual;
- variance;
- contingency.

### Operations
- critical backlog;
- downtime;
- service burden.

### Strategy
- properties by posture;
- target-readiness;
- programme outcomes.

### Evidence
- coverage/freshness.

## 42. Committee exception queue

Surface only decision-relevant exceptions:

- mandatory unfunded item;
- major variance;
- target date at risk;
- capex approval expired;
- condition unmet;
- long-lead miss;
- capacity conflict;
- recall surge;
- stale critical evidence;
- strategy outcome materially off target.

## 43. Scenario provenance

Store:
- input snapshots;
- objective profile;
- capital constraints;
- financial assumptions;
- operating data cutoff;
- lifecycle/capex versions;
- optimizer version;
- generated_at;
- actor-created overrides.

## 44. Manual override

Committee/authorised user may override recommended allocation.

Required:
- before/after;
- reason;
- approver;
- date;
- affected constraints/outcomes.

No silent override.

## 45. Portfolio confidence profile

Expose separate:
- property-data coverage;
- lifecycle coverage;
- cost coverage;
- operating-performance coverage;
- capital-plan maturity;
- transfer/refinancing coverage;
- scenario assumption completeness.

No single confidence score.

## 46. Property comparison

Comparison must normalize for context where possible.

Avoid naive ranking by:
- spend;
- failures;
- occupancy;
- downtime

without exposure/size/business-model normalization.

## 47. Benchmarking boundary

Cross-property benchmarking may use:
- cost per m2;
- service events per asset-year;
- downtime per occupied unit;
- CapEx per room/unit;
- maintenance compliance;
- backlog per asset.

Metric definitions must be explicit.

## 48. Sensitive allocation risks

Do not allocate capital based on hidden or inappropriate sensitive-person characteristics.

Portfolio decisions should operate on property/business facts and explicit policy.

## 49. Financing / lender boundary

If refinancing is a target:
- track readiness;
- required documents;
- capital work;
- timing;
- scenario cash flows.

Do not claim:
- approval probability;
- lender credit decision;
- collateral value.

## 50. Investment-return boundary

Renova may calculate explicitly provided financial formulas/scenarios such as:
- payback;
- NPV;
- IRR;
- cash flow.

Only from user-entered/source-backed assumptions.

Do not present these as investment advice or expected market return.

## 51. Acquisition boundary

Future acquisition due diligence could reuse evidence models, but this contract does not authorize:
- deal sourcing;
- acquisition recommendation;
- bid price;
- valuation.

## 52. Evidence portability

Committee decisions may export a bounded evidence package:
- scenario;
- decision;
- sources;
- assumptions;
- approval lineage;
- outcome tracking.

External consumers receive purpose-scoped data only.

## 53. Board / IC presentation mode

Presentation should answer in 30–60 seconds:
1. what decision is requested;
2. why now;
3. alternatives;
4. capital impact;
5. mandatory risk;
6. operating/disruption impact;
7. uncertainties;
8. recommendation;
9. exact approval required.

## 54. Drill-down

Every committee-level number must drill:

`portfolio -> programme -> property -> asset -> evidence/source`.

No dead-end KPI.

## 55. Audit receipt

For every material decision:
- decision_id;
- scenario version;
- input snapshots;
- pack hash/version;
- approver;
- conditions;
- overrides;
- resulting programme;
- execution links;
- outcome review.

## 56. Actual strategy performance

Evaluate later:

- approved capital vs actual;
- approved timing vs actual;
- expected operating KPI vs actual;
- backlog change;
- reliability change;
- disruption change;
- transfer/refinancing readiness achieved/not;
- evidence maturity.

## 57. Strategy effectiveness metrics

### Mandatory coverage improvement
change in funded/resolved mandatory backlog.

### Capital adherence
actual/reconciled vs approved baseline.

### Strategy execution rate
approved strategic actions completed / due actions.

### Decision cycle time
decision date - first complete decision-ready pack date.

### Conditional-approval closure
conditions satisfied by due date.

### Outcome evidence coverage
programmes with measurable post-execution outcome.

## 58. Decision quality metrics

Use process quality, not "AI accuracy":

- percentage of decisions with complete source pack;
- percentage with alternatives;
- percentage with explicit assumptions;
- override rate;
- strategy reversals/supersessions;
- late evidence corrections;
- unplanned mandatory events.

## 59. Pilot design

Start with:
- 10–30 properties;
- one owner/portfolio;
- known annual capital cycle;
- existing committee process;
- reliable capital actuals;
- 2–3 strategic programmes.

Pilot:
1. reproduce current committee pack;
2. trace every number;
3. add scenario comparison;
4. freeze approved baseline;
5. track execution/outcomes;
6. measure preparation time and decision clarity.

## 60. Commercial packaging

### Portfolio Owner
- objectives/postures;
- capital scenarios;
- committee packs;
- outcome tracking.

### Asset Management Team
- portfolio comparison;
- hold/improve/reposition/dispose governance;
- programme management;
- target readiness.

### Investment Committee / Board
- decision-ready packs;
- approvals;
- conditions;
- audit trail;
- actual vs approved strategy.

### Operator / Property Manager
- execution projection only;
- assigned programmes;
- constraints/conditions;
- evidence/outcomes.

## 61. Strategic moat

The defensible chain becomes:

```
property identity
+ lifecycle evidence
+ operating context
+ capital need
+ approved strategy
+ committee decision lineage
+ execution evidence
+ actual outcome
```

This creates a longitudinal record not only of what happened to the building, but **why the owner chose to act, defer, improve or prepare for transfer — and what happened afterward**.

## 62. Anti-patterns — REJECT

- automated "buy/sell/hold" recommendation;
- opaque portfolio score;
- market valuation without valuation authority;
- investment return claims from unsourced assumptions;
- hidden capital allocation model;
- committee pack without data cutoff/coverage;
- rewriting an approved strategy baseline;
- disposition label triggering transaction;
- financing-readiness shown as lender approval;
- strategy success claimed without outcome evidence;
- AI approving or voting.

## 63. Definition of Done — Governance foundation

- portfolio objectives are explicit/versioned;
- property strategy postures have evidence;
- scenario inputs are reproducible;
- committee pack is source-traceable;
- approval roles/limits are enforceable;
- decisions create immutable/supersedable ledger entries;
- conditional approvals are tracked.

## 64. Definition of Done — Capital allocation

- hard constraints precede optimization;
- mandatory funding gap is visible;
- allocation rationale is explainable;
- overrides are audited;
- no single hidden score controls ranking;
- capital programmes link back to exact assets/evidence.

## 65. Definition of Done — Outcome loop

- approved baseline is frozen;
- execution links back to decision;
- actual capital and schedule are measured;
- strategic KPI outcomes are measured where defined;
- causal claims are bounded;
- committee can review what changed and why.

## 66. Strict sequencing

1. portfolio objective + posture model;
2. portfolio fact pack;
3. scenario portfolio model;
4. capital allocation constraints;
5. committee decision pack;
6. approval/quorum/delegated-authority workflow;
7. Decision Ledger linkage;
8. frozen strategy baseline;
9. execution/outcome tracking;
10. portfolio scenario optimizer;
11. advanced benchmarking only after normalization/coverage is proven.
