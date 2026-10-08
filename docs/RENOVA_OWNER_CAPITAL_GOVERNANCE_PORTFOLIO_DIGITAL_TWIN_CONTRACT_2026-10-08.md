# Renova — Owner Capital Governance & Portfolio Digital Twin Contract

**Date:** 2026-10-08  
**Status:** RESEARCH / OWNER OPERATING SYSTEM CONTRACT  
**Implementation gate:** after Portfolio Strategy & Investment Committee OS governance foundation, stable Decision Ledger linkage, and reliable capital actual-vs-plan history.  
**Depends on:** Portfolio Strategy & Investment Committee OS, Capital Planning & Asset Strategy, Property Lifecycle Intelligence, Property Operations Network, Property Trust/Transfer profiles, Decision Ledger, canonical finance/ERP exports where available.  
**Authority rule:** the Owner Digital Twin is a versioned decision/evidence projection. It is not the legal title registry, accounting ledger, bank, valuation authority, construction authority, or autonomous portfolio controller.

## 1. Purpose

The Owner Capital Governance & Portfolio Digital Twin provides one versioned owner-level snapshot answering:

```
what the owner controls
-> what physically exists
-> what is operating
-> what is committed
-> what is funded
-> what is approved
-> what is under construction / remediation
-> what is ready for transfer / refinancing
-> what decisions are pending
-> what changed since the last approved owner / IC snapshot
```

This is the owner-level operating model above property, lifecycle, capital and committee layers.

## 2. Core principle: one snapshot, many authorities

The twin does not replace source systems.

Each field must retain:

- source system/domain;
- source object ID;
- source version;
- effective date;
- freshness;
- confidence/coverage where applicable;
- authority class.

Examples:

- legal ownership -> legal/corporate source;
- accounting actual -> ERP/accounting;
- property condition -> admitted property evidence;
- capital approval -> Decision Ledger / committee record;
- work completion -> canonical project/service domain;
- transfer readiness -> Trust/Transfer profile;
- financing scenario -> planning assumption only.

## 3. Owner graph

Represent the owner ecosystem:

- owner;
- legal entity;
- SPV;
- holding company;
- operating company;
- management company;
- property;
- project;
- asset/system;
- programme;
- funding source;
- decision body.

Edges may include:

- owns;
- controls;
- operates;
- manages;
- funds;
- guarantees;
- leases;
- services;
- approves;
- reports_to.

Legal ownership must come from an explicit authoritative source where available.

## 4. Ownership state semantics

Possible states:

- verified_owner;
- verified_controller;
- verified_operator;
- verified_manager;
- claimed_unverified;
- historical;
- unknown.

Do not infer legal ownership from who manages the property in Renova.

## 5. Portfolio twin snapshot

A snapshot includes:

- snapshot_id;
- portfolio_id;
- effective_at;
- generated_at;
- source cutoffs;
- policy/profile versions;
- property set;
- entity ownership/control map;
- capital state;
- operating state;
- execution state;
- transfer/refinancing state;
- decision queue;
- unresolved conflicts;
- coverage profile.

Snapshots are immutable once referenced by an approved decision.

## 6. Temporal model

Support:

- current snapshot;
- prior approved snapshot;
- fiscal-period snapshot;
- committee snapshot;
- transaction/transfer snapshot;
- ad hoc investigation snapshot.

Users must be able to compare any two compatible snapshots.

## 7. Change model

Every snapshot delta should classify change as:

- ownership/control;
- physical asset;
- operating status;
- capital;
- funding;
- approval;
- programme;
- construction/execution;
- trust/evidence;
- transfer/refinancing;
- risk/obligation;
- decision/governance.

## 8. Owner-level questions

The twin should answer directly:

- What do we own/control?
- What changed physically?
- What capital is committed?
- What capital is approved but not committed?
- What is unfunded but mandatory?
- What is currently under execution?
- What is delayed?
- What requires owner/committee decision?
- Which properties are transfer/refinance candidates?
- Which properties have unresolved trust/evidence blockers?
- What materially changed since the last committee?

## 9. Capital state reconciliation

For each capital item/programme show separately:

- approved;
- committed;
- invoiced;
- paid;
- reconciled actual;
- remaining commitment;
- forecast to complete;
- contingency;
- variance.

Do not collapse these into one "spent" field.

## 10. Funding state

Possible planning/fact states:

- funded;
- partially_funded;
- approved_not_funded;
- committed_funding;
- scenario_funding;
- financing_pending;
- unfunded;
- unknown.

Funding source may include:

- cash;
- reserve;
- debt;
- vendor finance;
- insurance recovery;
- tenant contribution;
- other explicit source.

## 11. Physical state

Property/asset physical state must derive from canonical evidence:

- installed;
- commissioned;
- operating;
- degraded;
- under_repair;
- under_replacement;
- decommissioned;
- unknown.

These are not AI-generated labels unless backed by admitted domain events.

## 12. Execution state

Owner-level execution projection may include:

- not_started;
- procurement;
- mobilising;
- in_progress;
- awaiting_inspection;
- blocked;
- complete_pending_evidence;
- completed;
- cancelled/superseded.

State remains sourced from canonical domains.

## 13. Strategy state

Per property:

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

Every posture links to the exact owner/committee decision version.

## 14. Transfer / refinancing state

Expose separately:

- target exists;
- target date;
- profile requested;
- current blockers;
- capital blockers;
- evidence blockers;
- consent/redaction blockers;
- ready_for_internal_review;
- external verification issued;
- completed/closed.

Do not represent readiness as transaction certainty.

## 15. Decision queue

The owner decision queue aggregates items requiring governance action.

Candidate decision classes:

- capital approval;
- funding gap;
- contingency draw;
- property posture;
- programme approval;
- repair/replace;
- deferral exception;
- transfer preparation;
- refinancing preparation;
- scope change;
- major variance;
- conflict/escalation;
- strategy supersession.

## 16. Decision priority

No opaque universal score.

Order first by hard governance/operational precedence:

1. safety / official recall / statutory;
2. legal/contract deadline;
3. business continuity;
4. approved transfer/refinance target at risk;
5. funding/approval blocker to committed work;
6. major capital/schedule variance;
7. strategic programme decision;
8. discretionary optimization.

## 17. Decision readiness

A decision item may be:

- ready;
- missing_evidence;
- missing_quote;
- missing_funding;
- missing_authority;
- conflicted;
- stale;
- superseded.

Do not send incomplete decisions to committee as if decision-ready.

## 18. Owner Home / Decision Surface

Primary owner surface should answer:

- What requires my decision?
- What changed since last review?
- What is materially off-plan?
- Where is mandatory funding missing?
- Which transfer/refinancing targets are at risk?
- Which programmes are on track?
- What evidence is stale or missing?

Avoid a giant passive KPI wall.

## 19. IC delta

For each committee cycle compare:

`current snapshot vs prior approved committee snapshot`

Show:

- new properties/entities;
- ownership/control changes;
- new mandatory obligations;
- capital changes;
- funding changes;
- approved decisions;
- programme status changes;
- cost/schedule variance;
- new transfer/refinancing targets;
- newly ready properties;
- new blockers;
- resolved blockers;
- evidence freshness deterioration/improvement.

## 20. Materiality policy

Not every change belongs in owner/IC delta.

Organisations may define materiality by:

- absolute amount;
- % variance;
- days delay;
- risk class;
- target impact;
- mandatory status;
- policy profile.

Materiality thresholds must be explicit and versioned.

## 21. Exception-first governance

Normal on-plan activity remains quiet.

Surface:

- unfunded mandatory;
- forecast overrun;
- schedule slip;
- expired approval;
- unmet condition;
- capacity/lead-time risk;
- major evidence conflict;
- transfer/refinance blocker;
- ownership/source conflict;
- pending owner decision.

## 22. Cross-domain reconciliation

The twin must detect contradictions such as:

- property shown as sold but operational programme still active;
- asset marked replaced but old asset remains current in passport;
- approved capital exists but no funding;
- project complete but evidence/acceptance missing;
- paid invoice with no linked approved/committed capital item;
- transfer target exists but mandatory capital programme missing;
- programme marked complete while constituent obligations remain open.

Conflicts become reconciliation items, not silently resolved.

## 23. Reconciliation states

- open;
- investigating;
- source_requested;
- resolved;
- accepted_exception;
- superseded.

Each has source lineage and actor.

## 24. Legal entity reconciliation

Capital, funding and property responsibilities must be mapped to the correct entity.

Do not infer:

- legal liability;
- beneficial ownership;
- guarantee;
- lender covenant responsibility

without explicit source.

## 25. Portfolio identity continuity

Properties/assets may undergo:

- rename;
- split;
- merge;
- SPV transfer;
- manager change;
- operator change;
- sale;
- partial disposition.

Maintain historical identity and lineage.

## 26. Transaction cut

For a sale/transfer event, create a snapshot cut:

- what evidence existed;
- what obligations remained;
- what capital was committed;
- what was disclosed;
- what approvals existed;
- what transferred;
- what remained with seller/owner where sourced.

This becomes a durable transaction record.

## 27. Owner commitments ledger

Track owner-level commitments separately from execution:

- approved programme;
- committed budget;
- contractual commitment;
- financing commitment;
- target date;
- transfer/refinancing commitment;
- board/committee condition.

Commitment status must derive from explicit source.

## 28. Promise vs plan vs fact

UI must distinguish:

- promise/commitment;
- approved plan;
- current forecast;
- actual fact.

These must never share the same visual state.

## 29. Programme digital twin

Each strategic programme may have its own twin:

- objective;
- approved scope;
- property/asset population;
- capital baseline;
- funding;
- procurement;
- execution;
- evidence;
- outcomes;
- decision history.

## 30. Property digital twin

Each property snapshot may combine:

- ownership/control;
- operating role;
- strategy posture;
- physical systems;
- lifecycle state;
- current works;
- capital plan;
- trust/transfer readiness;
- decisions;
- outcomes.

This is a semantic/evidence twin, not necessarily a 3D model.

## 31. Spatial twin integration

2D/3D/BIM/360 may be attached as spatial projections.

Spatial model does not become the authority for:

- ownership;
- accounting;
- acceptance;
- asset status;
- decision approval.

## 32. Portfolio map

Geographic map may show:

- properties;
- strategy posture;
- active major programmes;
- transfer/refinance target;
- critical exceptions.

Avoid exposure of sensitive exact locations to unauthorised actors.

## 33. Capital governance calendar

Calendar may combine:

- committee dates;
- approval expiry;
- funding tranches;
- procurement deadlines;
- major shutdowns;
- replacement waves;
- refinancing/transfer targets;
- annual planning cycle.

## 34. Owner review cadence

Support:

- daily exception view;
- weekly owner ops review;
- monthly capital review;
- quarterly IC;
- annual strategy;
- event-driven review.

## 35. Approval expiry

Some approvals may expire if:

- quote changes;
- scope changes;
- deadline passes;
- funding changes;
- material condition changes;
- committee policy requires refresh.

Expired approval must not silently remain valid.

## 36. Condition tracking

Approved-with-conditions decisions should surface:

- condition;
- owner;
- due date;
- evidence required;
- status;
- blocker impact.

## 37. Owner instructions

An owner decision may produce instructions to:

- asset manager;
- property manager;
- procurement;
- finance;
- project team;
- service coordinator.

Instruction does not grant new ACL automatically.

## 38. Instruction acknowledgement

Track:

- issued;
- acknowledged;
- accepted;
- challenged;
- superseded;
- completed.

Canonical business execution remains in underlying domains.

## 39. Escalation

Escalate when:

- mandatory unfunded persists;
- approval condition overdue;
- major variance threshold crossed;
- target date becomes infeasible;
- source conflict unresolved;
- execution blocked beyond policy;
- financing/funding assumption invalidated.

## 40. Owner portfolio snapshot pack

A durable snapshot package may include:

- portfolio entity graph;
- strategy postures;
- capital/funding summary;
- execution summary;
- major exceptions;
- decision queue;
- transfer/refinance targets;
- changes since prior snapshot;
- evidence coverage;
- exact source references.

## 41. Snapshot hash / integrity

For approved owner/IC snapshots, store a canonical representation/hash where architecture permits.

Purpose:
- prove exact review version;
- compare later;
- prevent silent history rewrite.

Hash does not replace signatures/identity where required.

## 42. External evidence packages

Potential bounded exports:

- board pack;
- lender/refinancing readiness pack;
- insurer pack;
- sale/transfer dossier;
- auditor/reviewer package;
- programme evidence pack.

Purpose limitation and ACL apply.

## 43. Source conflict handling

If sources disagree:

- preserve both;
- mark conflict;
- identify authority hierarchy/policy;
- request resolution;
- do not silently choose whichever improves portfolio status.

## 44. Freshness model

Track freshness for:

- ownership/control;
- capital actuals;
- funding;
- programme status;
- asset state;
- lifecycle;
- trust/transfer;
- operating performance.

A stale owner snapshot must say so.

## 45. Coverage model

Expose separate coverage dimensions:

- entity/ownership;
- physical asset;
- lifecycle;
- capital;
- funding;
- operating performance;
- execution;
- trust/transfer;
- governance.

No universal twin-completeness score.

## 46. Timeline

Owner timeline may include:

- ownership/control changes;
- major acquisitions/dispositions if sourced;
- capital approvals;
- funding commitments;
- programme launches;
- major completions;
- recalls/incidents;
- transfer/refinance milestones;
- committee decisions.

## 47. Portfolio narrative

AI may generate a narrative such as:

"Since the last IC, mandatory CapEx increased because of X, programme Y moved by 45 days, property Z reached transfer-readiness review, and two decisions require approval."

Narrative must cite underlying facts.

## 48. AI boundary

AI may:

- summarise snapshot delta;
- draft committee narrative;
- explain reconciliation;
- draft decision memo;
- answer owner questions with citations.

AI may not:

- invent ownership;
- approve capital;
- classify legal liability;
- vote;
- alter strategy posture without governed user action;
- mark reconciliation resolved without evidence;
- fabricate financial actuals.

## 49. Search / command surface

Owner may ask:

- "Что изменилось с прошлого IC?"
- "Покажи все unfunded mandatory items."
- "Какие объекты не успевают к refinancing?"
- "Где approved, но ещё не committed?"
- "Какие программы ушли за baseline?"
- "Какие решения ждут меня?"

Every answer drills to canonical sources.

## 50. Data-room mode

For an authorised transaction/review:

- freeze purpose-specific snapshot;
- select permitted evidence;
- redact;
- issue bounded package;
- track disclosure receipt;
- expiry/revocation where applicable.

## 51. Ownership privacy

Owner/entity graph may contain highly sensitive corporate information.

Require:

- strict role scope;
- legal-entity-level ACL;
- purpose-specific export;
- no provider exposure;
- audit for access/export;
- redaction where needed.

## 52. Multi-owner / JV governance

Future support may include:

- ownership percentage where sourced;
- voting rights where sourced;
- reserved matters;
- co-investor approval requirements.

Do not infer governance from percentage ownership alone.

## 53. Consolidation scope

Portfolio reports must define consolidation:

- fully consolidated;
- proportionate;
- managed-only;
- controlled-not-owned;
- excluded.

Financial consolidation remains accounting authority outside Renova unless explicitly integrated.

## 54. KPI lineage

Every portfolio KPI must carry:

- formula;
- scope;
- period;
- source systems;
- data cutoff;
- exclusions;
- currency/normalization.

## 55. Actual-vs-strategy

Compare:

- approved posture;
- approved capital;
- approved milestones;
- expected outcome metrics;
- actual capital;
- actual milestones;
- actual outcome;
- reasons for divergence.

## 56. Strategy drift

Surface if:

- repeated decisions materially diverge from approved objective;
- portfolio posture changes without formal strategy update;
- discretionary spend crowds mandatory programme;
- repeated emergency work replaces planned capital.

This is a governance signal, not automatic misconduct classification.

## 57. Portfolio resilience view

Potential dimensions:

- critical-system redundancy;
- maintenance continuity;
- provider concentration;
- supply concentration;
- mandatory backlog;
- long-lead exposure;
- funding gap.

Keep dimensions separate.

## 58. Owner mandate

Record explicit mandate such as:

- protect downside;
- prepare 20 assets for sale;
- reduce backlog;
- cap annual spend;
- standardise HVAC;
- preserve hotel occupancy;
- accelerate refinancing.

All scenario optimization references the current mandate version.

## 59. Mandate supersession

When owner mandate changes:

- preserve prior version;
- show impact on portfolio plan;
- identify decisions/programmes now inconsistent;
- require review where material.

## 60. Operating model by role

### Owner / Principal
- decision queue;
- IC delta;
- capital/funding;
- strategic posture;
- exceptions.

### CIO / Head of Asset Management
- scenario portfolio;
- programme performance;
- funding gaps;
- transfer/refinancing pipeline.

### CFO / Finance
- approved/committed/actual;
- funding source;
- cash-flow/variance;
- reconciliation exceptions.

### COO / Property Operations
- execution;
- capacity;
- downtime;
- mandatory backlog.

### Board / IC
- decision packs;
- conditions;
- approvals;
- outcomes.

Same facts, different projections.

## 61. Export / API projection

Candidate read surfaces:

- `GET /owner-portfolios/{id}/snapshot`
- `GET /owner-portfolios/{id}/delta?from=&to=`
- `GET /owner-portfolios/{id}/decisions`
- `GET /owner-portfolios/{id}/reconciliation`
- `POST /owner-portfolios/{id}/snapshot-freeze`
- `POST /owner-portfolios/{id}/review-pack`

Mutation endpoints create governed intents, not direct writes into source-domain tables.

## 62. Test matrix

Required:

- ownership source conflict;
- manager != owner;
- capital approved but unfunded;
- funded but not approved;
- approved but not committed;
- committed vs actual distinction;
- project complete but evidence missing;
- asset replaced but passport stale;
- transfer target with unresolved capital blocker;
- stale committee snapshot;
- exact IC delta;
- materiality threshold;
- approval expiry;
- conditional approval overdue;
- legal entity mismatch;
- property sold/removed while programme active;
- snapshot immutability;
- hash/version changes only when content changes;
- AI narrative cites only present facts;
- source-system outage marks stale rather than zero.

## 63. Pilot design

Pilot with:

- 10–30 properties;
- one owner group;
- 2–5 legal entities;
- existing quarterly IC;
- stable capital actuals;
- known strategy postures;
- at least one transfer/refinancing target.

Steps:

1. reproduce current owner portfolio pack;
2. reconcile ownership/entity map;
3. reconcile approved/committed/actual capital;
4. build decision queue;
5. generate IC delta;
6. freeze committee snapshot;
7. measure preparation time, reconciliation defects and decision traceability.

## 64. Commercial packaging

### Owner OS Core
- portfolio snapshot;
- decision queue;
- delta;
- strategy posture.

### Capital Governance
- approved/committed/actual;
- funding gaps;
- programmes;
- variance.

### Board / Investment Committee
- review packs;
- approvals/conditions;
- immutable snapshots;
- outcome tracking.

### Transaction / Refinancing
- target readiness;
- bounded data-room snapshot;
- evidence disclosure.

## 65. Strategic moat

The strongest asset becomes the owner's longitudinal operating graph:

```
entity/ownership
+ property identity
+ physical/lifecycle truth
+ capital/funding
+ approved decisions
+ execution
+ transfer/refinancing
+ outcomes
+ snapshot history
```

This allows Renova to answer not only "what is happening?", but "what changed, what was decided, what is still unresolved, and what outcome followed?"

## 66. Anti-patterns — REJECT

- owner dashboard with unsourced aggregate numbers;
- treating manager/operator as legal owner;
- blended approved/committed/actual capital;
- single twin health score;
- silent source conflict resolution;
- mutable historical IC snapshot;
- transfer readiness presented as transaction certainty;
- financing scenario presented as financing commitment;
- AI deciding owner posture/capital approval;
- digital twin defined only as 3D geometry.

## 67. Definition of Done — Snapshot foundation

- owner/entity graph is source-backed;
- snapshot is immutable/versioned;
- each value has authority/source;
- capital/funding states are distinct;
- physical/execution/strategy states retain canonical lineage;
- coverage/freshness is visible;
- prior/current delta is reproducible.

## 68. Definition of Done — Governance

- decision queue is explicit;
- decision readiness exists;
- materiality policy is versioned;
- IC delta is generated from snapshot comparison;
- approvals/conditions link to Decision Ledger;
- approval expiry and mandate supersession work;
- reconciliation conflicts are auditable.

## 69. Definition of Done — Owner OS

- owner can answer core portfolio questions without manual reconciliation;
- CFO/COO/Asset Management views project the same canonical facts;
- transaction/refinancing snapshots are purpose-scoped;
- strategy actual-vs-plan is traceable;
- AI narratives cite exact facts;
- no source outage becomes fabricated zero/current state.

## 70. Strict sequencing

1. owner/entity graph + source classes;
2. portfolio snapshot schema;
3. capital/funding reconciliation;
4. physical/execution/strategy projections;
5. decision queue + readiness;
6. snapshot delta / IC delta;
7. materiality policies;
8. reconciliation workbench;
9. frozen owner/committee snapshots;
10. role-specific owner/CFO/COO/IC projections;
11. transaction/refinancing snapshot packages;
12. AI cited narrative only after source lineage is complete.
