# Renova — Strategic Execution Map 2026–2028

**Date:** 2026-10-08  
**Status:** EXECUTION ROADMAP / DEPENDENCY MAP  
**Repository:** `PetrFedin/renova`  
**Authority:** execution companion to `RENOVA_INTEGRATION_MASTER_PLAN_2026-10-01.md` and `RENOVA_RESEARCH_RADAR_2026-10-07.md`.  
**Rule:** this document distinguishes proven runtime capability from research contracts. A documented capability is not treated as implemented until its schema/API/UX/CI and release evidence are green on the canonical PostgreSQL topology.

---

## 1. Why this map exists

Renova now has a large set of research contracts covering:

- Verified Execution;
- Property Passport / Verified Building History;
- Trust Matrix;
- Property Action Engine;
- Intervention Optimizer;
- Property Operations Network;
- Lifecycle Intelligence;
- Capital Planning;
- Portfolio Strategy / Investment Committee;
- Owner Digital Twin;
- External Institutional Network;
- Verified Property Network Protocol.

The strategic risk is no longer lack of ideas. The risk is implementing them out of dependency order.

This map converts the research stack into:

```
current release gates
-> dependency DAG
-> implementation slices
-> schema/API/UX work
-> CI gates
-> pilot gates
-> production/adoption gates
```

---

# 2. Current repository truth — 2026-10-08

## 2.1 Canonical main

Current `main` remains:

`f62e491aeb2c0b8a36bbbd15af719050d692546c`

The research branch is documentation-only and must not be interpreted as runtime delivery.

## 2.2 Current admission gate — PR #683

PR #683:

- title: `fix(security): qualify admission with current infrastructure contracts`;
- head: `60767c868260e35345cac8cb5a91ed9fac31a638`;
- mergeable: true;
- not merged;
- core admission changes are qualified;
- current exact-head workflow history still contains failed/cancelled `claude-agent` / `agent-pr-policy` runs;
- PR body explicitly records owner credential/workload restoration as remaining second-agent gate.

**Execution consequence:** no research runtime wave may bypass #683.

## 2.3 Verified Execution Record — PR #668

PR #668:

- title: `feat: add Verified Execution Record v1`;
- head: `4ca82b6f5e9784cff7638c49d6f1d6b952da63a0`;
- mergeable: true;
- not merged;
- adds accepted-stage-derived Verified Execution Record;
- portable redacted proof;
- Ed25519 platform checkpoint;
- public verification;
- persistent revocation.

Its original evidence was green on its own qualified trust head, but current workflow history also contains inherited failures against the old admission baseline.

**Execution consequence:** after #683 lands, #668 must be rebased/refreshed and requalified on the new exact `main`.

## 2.4 Golden Paths — qualification PR #695

PR #695:

- draft / evidence-only;
- base = exact #683;
- current head: `27b39878f079fc2fe4faab999db204370f5195c2`;
- previous integrated qualification recorded API Golden 10/12 and mobile-web 8/8;
- current exact-head workflow set is mostly green but `agent-pr-policy` is failing and `claude-agent` is skipped;
- `docs/technical-spec/GOLDEN-PATHS.md` still carries older "written, run blocked" status text and therefore must be reconciled to final exact-head evidence before Golden Paths become release authority.

**Execution consequence:** #695 is not merged. Its purpose is to prove the combined fixes, then the bounded product fixes must enter the real merge path with exact-head qualification.

## 2.5 Runtime capabilities already present in main

The repository already contains strong canonical domains and infrastructure including:

- project lifecycle;
- rooms / estimates / budget;
- marketplace / contractor flow;
- stages / schedules / work orders;
- acceptance / rework;
- payment lifecycle / refunds / disputes / reconciliation;
- materials;
- documents / OCR / e-sign provider boundaries;
- chat / inbox / notifications / automation;
- warranty API and warranty claim service;
- technical supervision / inspection-related runtime;
- PostgreSQL integrity gates;
- outbox / worker patterns;
- mobile-web/E2E infrastructure;
- audit/security integrity gates.

These are implementation assets to reuse.

## 2.6 Research-only or not yet runtime-authoritative

The following are **not** treated as production runtime in current `main`:

- Property Passport as the full lifecycle identity product;
- Verified Building History as the complete property history graph;
- Decision Ledger as the canonical decision-governance domain;
- Property Trust Matrix;
- Property Action Engine;
- Property Intervention Optimizer;
- Property Operations Network;
- Lifecycle Intelligence;
- Capital Planning & Asset Strategy;
- Portfolio Strategy / Investment Committee OS;
- Owner Digital Twin;
- External Institutional Network;
- Verified Property Network Protocol.

Some foundations exist in current domains, but the named layers themselves require implementation.

---

# 3. Master dependency DAG

```
G0 Release Admission
  #683 security/admission
  -> Golden Paths exact-head
  -> capability-aware multi-role UX
  -> stable release contour

G1 Verified Execution Foundation
  #668 Verified Execution Record
  -> portable proof
  -> checkpoint verification
  -> issuer lifecycle / key rotation / status

G2 Property Identity & Evidence Foundation
  property identity
  -> installed assets
  -> commissioning / maintenance / warranty lineage
  -> Verified Building History
  -> Decision Ledger

G3 Trust Foundation
  G2
  -> Trust Exchange Profiles
  -> Trust Matrix
  -> signed/current verification

G4 Remediation
  G3
  -> Property Action Engine
  -> canonical action bindings
  -> closure predicates
  -> Recovery Plan

G5 Intervention Optimization
  G4
  -> intervention graph
  -> hard constraints
  -> Service Visit Bundling
  -> scenario comparison

G6 Operations Network
  G5 + provider/service facts
  -> deterministic service demand
  -> provider capacity
  -> parts availability
  -> routing
  -> maintenance campaigns
  -> recall blast radius

G7 Lifecycle Intelligence
  G6 + reconciled history
  -> lifecycle ledger
  -> actual lifecycle cost
  -> cohorts/exposure
  -> descriptive reliability
  -> repair vs replace

G8 Capital Strategy
  G7
  -> CapEx states
  -> 5-year plan
  -> lead times/capacity/disruption
  -> replacement waves
  -> actual vs plan

G9 Portfolio Governance
  G8 + Decision Ledger
  -> portfolio objectives/postures
  -> scenarios
  -> IC packs
  -> approvals/conditions
  -> frozen strategy baseline
  -> outcomes

G10 Owner Digital Twin
  G9
  -> owner/entity graph
  -> immutable portfolio snapshots
  -> capital/funding reconciliation
  -> decision queue
  -> IC delta
  -> reconciliation workbench

G11 External Institutional Network
  G10 + Trust Exchange + issuer/status
  -> institution credentials
  -> signed requests
  -> purpose-scoped data rooms
  -> verification receipts
  -> transaction checkpoints
  -> diligence delta

G12 Verified Property Network Protocol
  G11 proven in pilots
  -> normative schemas
  -> canonical encoding
  -> reference verifier
  -> reference issuer
  -> conformance
  -> SDKs
  -> independent implementations
```

No phase should depend on a higher phase.

---

# 4. Gate 0 — Stabilise the product before new strategic runtime

**Target:** immediate / 2026 Q4.

## G0.1 Admission exact-head

Strict sequence:

```
restore second-agent credential/workload identity
-> rerun #683 exact-head
-> all required checks GREEN
-> reviews/threads clean
-> merge #683
-> record new exact main SHA
```

### CI gate

Required:

- security operations;
- JS dependencies;
- backend dependencies;
- image integrity;
- schema integrity;
- push/outbox integrity;
- CodeQL;
- typecheck/snapshot;
- second-agent review;
- branch ruleset compliance.

No gate suppression.

## G0.2 Requalify Verified Execution Record

```
new main after #683
-> rebase/refresh #668
-> run full backend + PostgreSQL schema + readiness + CodeQL
-> prove stale/revoked/tamper/fail-closed behavior
-> merge exact-head
```

## G0.3 Golden Paths

Use #695 only as qualification evidence.

Required final state:

- GP1–GP8 API green;
- GP1–GP8 mobile-web green;
- canonical PostgreSQL/Redis/MinIO/API/Worker topology;
- providers simulated;
- no seed except documented cases;
- human business semantics pass;
- GOLDEN-PATHS status table updated from real evidence.

### Release decision

Golden Paths become a required release contour only after a clean exact-head run.

## G0.4 Capability-aware UX

After Golden Paths:

roles/capabilities:

- owner/customer;
- contractor lead;
- foreman/project lead;
- participant/member;
- supervisor/reviewer;
- guest/read-only;
- admin/operator.

### Acceptance

- user sees only authorised decisions;
- no role leaks;
- next action is clear;
- offline/queued/server-confirmed truth remains visible;
- phone/tablet/desktop critical journeys pass.

---

# 5. Wave 1 — Property Identity, Passport, History, Decision Ledger

**Target:** 2026 Q4 → 2027 Q1.  
**Prerequisite:** Gate 0 green.

This is the most important new runtime foundation. Do not start Trust Matrix before this data model is stable.

## Slice P1 — Property Identity

### Schema / migrations

Add canonical entities for:

- property identity;
- building/unit relationship;
- external registry references;
- identity aliases;
- merge/split lineage;
- authority/source metadata.

### API

Candidate:

- `GET /properties/{id}/identity`
- `POST /properties/{id}/identity-sources`
- `GET /properties/{id}/identity-history`

### CI

- duplicate identity;
- merge/split lineage;
- wrong-property isolation;
- historical identity durability;
- no inferred legal ownership.

## Slice P2 — Installed Asset Registry

### Schema

- installed asset;
- asset class;
- manufacturer/model/variant;
- serial/batch;
- room/zone;
- installation;
- commissioning;
- status;
- warranty linkage;
- source/provenance.

### Reuse existing domains

Warranty and inspection/service evidence must link to this registry rather than creating parallel asset concepts.

### UX

Property Passport:

- Systems;
- Installed Assets;
- Service/Warranty;
- Evidence;
- History.

## Slice P3 — Verified Building History

Event projection over:

- accepted work;
- inspection;
- service;
- warranty;
- replacement;
- document/evidence;
- recall;
- commissioning.

### Gate

History is append-only/supersedable; no silent rewrite.

## Slice P4 — Decision Ledger v1

### Schema

- decision;
- subject/scope;
- alternatives;
- decision text;
- actor/authority;
- evidence snapshot;
- conditions;
- effective/expiry;
- supersession.

### API / UX

- decision list;
- decision detail;
- create governed decision;
- supersede;
- source/evidence drill-down.

### CI

- immutable historical decision;
- supersession;
- stale decision review;
- ACL;
- no decision grants unrelated access.

### Wave 1 exit gate

A property can be reconstructed as:

`identity -> installed assets -> admitted history -> decisions -> evidence`.

---

# 6. Wave 2 — Trust Infrastructure

**Target:** 2027 Q1.  
**Prerequisite:** Wave 1 + #668 verified execution.

## Slice T1 — Source admission model

Versioned source classes:

- owner-attested;
- contractor-issued;
- supervisor/inspection;
- manufacturer;
- registry/public source;
- platform-derived;
- external institution.

## Slice T2 — Property Trust Matrix v1

Implement deterministic requirement-policy engine.

Initial dimensions:

- History Coverage;
- Evidence Completeness;
- Maintenance Continuity;
- Source Freshness;
- Unresolved Risk & Obligations;
- Transfer Readiness;
- Provenance Strength.

### Schema

Prefer versioned policies + immutable snapshots, not mutable score fields.

### API

- `GET /properties/{id}/trust-matrix`
- `GET /properties/{id}/trust-matrix/snapshots`
- `GET /properties/{id}/trust-requirements/{requirement_id}`

### UX

- posture;
- independent dimensions;
- coverage;
- blockers;
- source drill-down.

### CI

- no universal score;
- unknown != bad;
- N/A semantics;
- coverage denominator;
- blocking precedence;
- source conflict;
- policy-version recompute.

## Slice T3 — Trust Exchange Profiles runtime

Convert existing profile contracts into machine-readable schemas/fixtures.

Start with:

- property_history_verify;
- transfer/buyer due diligence;
- insurer pre-loss;
- insurer claim evidence.

Lender only with a real or credible pilot partner.

## Slice T4 — Issuer lifecycle

Build:

- issuer metadata;
- active/retired/revoked keys;
- rotation;
- artifact status;
- supersession;
- public minimal verification.

### Wave 2 exit gate

A third party can verify a bounded property artifact and determine:

- what it is;
- who issued it;
- whether signature is valid;
- whether current/revoked/superseded;
- source cutoff.

---

# 7. Wave 3 — Property Action Engine

**Target:** 2027 Q1–Q2.  
**Prerequisite:** Trust Matrix stable.

## Slice A1 — Requirement/action routing registry

Versioned mapping:

`requirement -> canonical domain action`.

Do not introduce new generic task domain where Service/Inspection/RFI/Warranty already exists.

## Slice A2 — Recommendation projection

Schema:

- recommendation identity;
- originating trust snapshot;
- requirement;
- cause fingerprint;
- state;
- due provenance;
- linked canonical entity.

## Slice A3 — Closure predicates

Implement per-requirement evaluators.

Critical rule:

`canonical task complete != requirement resolved`.

## Slice A4 — Event-driven recompute

```
canonical commit
-> outbox event
-> affected requirements
-> matrix snapshot
-> recommendation reconciliation
```

## Slice A5 — Recovery Plan UI

Owner/manager:

- why;
- responsible;
- deadline/source;
- canonical action;
- evidence needed;
- dependencies.

## CI

- dedupe;
- reopen;
- recurrence;
- closure failure;
- snooze/dismiss/waiver distinction;
- offline cannot close;
- AI cannot waive/resolve.

### Wave 3 pilot

10–30 properties with:

- maintenance;
- warranty;
- transfer preparation.

---

# 8. Wave 4 — Intervention Optimizer

**Target:** 2027 Q2.  
**Prerequisite:** Action Engine outcome data.

## Slice O1 — Intervention graph

Read-only projection of:

- blockers;
- canonical actions;
- dependencies;
- capabilities;
- access windows;
- sourced costs;
- evidence outputs.

## Slice O2 — Hard constraint evaluator

Implement deterministic feasibility before optimization.

## Slice O3 — Service Visit Bundling v1

First commercially valuable optimization.

Prove:

- compatible provider capability;
- same access window;
- dependency order;
- separate evidence;
- independent closure predicates.

## Slice O4 — Scenario comparison

Initial objectives:

- critical-first;
- minimum visits;
- transfer acceleration;
- minimum disruption.

Avoid advanced solver first.

## UX

- recommended order;
- grouped visits;
- rejected bundle reason;
- alternative scenarios;
- pinned commitments.

## CI

- independent inspection separation;
- provider certification;
- unknown cost/time;
- stale plan;
- conflicting pins;
- optimizer outage fallback.

### Pilot exit metrics

Measure:

- visits avoided vs explicit baseline;
- repeat-visit rate;
- evidence completeness;
- remediation lead time.

No public savings claim before measured.

---

# 9. Wave 5 — Property Operations Network

**Target:** 2027 Q2–Q3.  
**Prerequisite:** Intervention Optimizer pilot.

## Slice N1 — Deterministic Service Demand Forecast

Only source-backed obligations first.

30/60/90-day view.

## Slice N2 — Provider Capability & Capacity Graph

Schema:

- capabilities;
- certifications;
- manufacturer authorisation;
- geography;
- capacity windows;
- evidence capability;
- freshness.

## Slice N3 — Parts & Materials Availability

- part identity;
- supplier observation;
- stock;
- reservation;
- lead time;
- approved substitutions.

## Slice N4 — Portfolio Visit Routing

Use routing provider only after sourced travel integration.

Pinned commitments must survive reoptimization.

## Slice N5 — Maintenance Campaigns

Cohort-based campaign without bulk closure.

## Slice N6 — Recall Blast Radius

Official recall:

`source -> exact/candidate asset match -> impacted cohort -> capacity/parts -> remediation -> evidence`.

### Wave 5 production gate

Pilot proves:

- demand accuracy;
- provider fit;
- part-ready visits;
- repeat-visit reduction;
- on-time maintenance.

Probabilistic predictive maintenance remains deferred.

---

# 10. Wave 6 — Lifecycle Intelligence

**Target:** 2027 Q3–Q4.  
**Prerequisite:** sufficient real service/repair/cost history.

## Slice L1 — Lifecycle Event Ledger

- install;
- commission;
- service;
- failure;
- repair;
- part replacement;
- asset replacement;
- downtime;
- warranty;
- recall;
- reconciled cost.

## Slice L2 — Deterministic Lifecycle Accounting

Separate:

- maintenance cost;
- repair cost;
- emergency cost;
- warranty-covered;
- owner-paid;
- downtime.

## Slice L3 — Cost Allocation

Explicit shared-cost allocation for multi-asset invoices.

## Slice L4 — Cohort Eligibility & Exposure

- identity quality;
- observation period;
- exposure denominator;
- censoring;
- evidence coverage.

## Slice L5 — Descriptive Reliability

No prediction yet.

- failure incidence;
- service incidence;
- repair-cost distribution;
- downtime distribution;
- replacement-age distribution with censoring discipline.

## Slice L6 — Repair vs Replace

Explicit 12/36/60-month horizon.

### Predictive gate

Predictive reliability may start only when:

- enough history;
- leakage-safe backtest;
- calibration;
- baseline comparison;
- drift plan.

---

# 11. Wave 7 — Capital Planning & Asset Strategy

**Target:** 2028 H1.  
**Prerequisite:** deterministic Lifecycle Intelligence + capacity/lead-time facts.

## Slice C1 — Capital Item / State Model

States:

- committed;
- approved;
- deterministic planned;
- scenario;
- predictive;
- actual/reconciled.

## Slice C2 — 5-Year Deterministic CapEx

Annual/quarterly phasing.

## Slice C3 — Indexation / FX / Lead Time

All assumptions source-labelled.

## Slice C4 — Disruption Calendar

Hotel / retail / office operational windows.

## Slice C5 — Replacement Waves

Asset-level justification preserved.

## Slice C6 — Baseline Freeze & Actual-vs-Plan

Approved programme becomes immutable baseline.

Variance:

- scope;
- price/index;
- FX;
- quantity;
- execution;
- unknown.

## Slice C7 — Funding Gap / Financing Scenarios

Planning only; no lender approval semantics.

### Wave 7 gate

CFO/asset manager can reconcile:

`approved -> committed -> actual -> forecast-to-complete`

against a frozen programme baseline.

---

# 12. Wave 8 — Portfolio Strategy & Investment Committee OS

**Target:** 2028 H1–H2.  
**Prerequisite:** capital actual-vs-plan history + Decision Ledger.

## Slice IC1 — Portfolio Objectives & Postures

- hold;
- improve;
- reposition;
- standardise;
- transfer/refinance preparation;
- dispose candidate;
- investigate.

## Slice IC2 — Property Strategy Fact Pack

One traceable pack per property.

## Slice IC3 — Portfolio Scenarios

Explicit capital envelope and assumptions.

## Slice IC4 — Committee Pack

30–60 second decision surface plus drill-down.

## Slice IC5 — Approval Governance

- quorum;
- delegated authority;
- conditions;
- conflict/recusal;
- supersession.

## Slice IC6 — Outcome Loop

Track what happened after decision.

### Gate

No AI approval, no autonomous buy/sell/hold.

---

# 13. Wave 9 — Owner Digital Twin

**Target:** 2028 H2.  
**Prerequisite:** Portfolio Governance.

## Slice D1 — Owner / Entity Graph

Source-backed:

- owner;
- holding;
- SPV;
- operator;
- manager;
- property.

## Slice D2 — Immutable Portfolio Snapshot

Temporal snapshot with source cutoffs.

## Slice D3 — Capital/Funding Reconciliation

Approved/committed/invoiced/paid/actual + funding state.

## Slice D4 — Decision Queue

Decision readiness and materiality.

## Slice D5 — IC Delta

`current vs prior approved snapshot`.

## Slice D6 — Reconciliation Workbench

Conflicts across domains.

## Slice D7 — Role Projections

Owner / Asset Management / CFO / COO / IC.

### Gate

Owner can answer core portfolio questions without manual spreadsheet reconciliation.

---

# 14. Wave 10 — External Institutional Network

**Target:** 2028+, pilot-driven.  
**Prerequisite:** Owner Digital Twin + Trust Exchange + issuer/status.

## Slice E1 — Institution Credentials

Organisation + representative authority.

## Slice E2 — Attributable/Signed Requests

Purpose, scope, profile, expiry.

## Slice E3 — Purpose-specific Data Room

Frozen owner-approved projection.

## Slice E4 — Verification Receipt

Minimal status/authenticity.

## Slice E5 — Supplemental Evidence Loop

Institution gap -> Action Engine -> refreshed artifact.

## Slice E6 — Transaction Checkpoints

Versioned institutional process stages.

## Slice E7 — Diligence Delta

Previous accepted snapshot -> exact changes.

### Preferred pilots

1. insurer pre-loss / restoration;
2. lender/refinancing technical diligence.

Do not start with an open marketplace.

---

# 15. Wave 11 — Verified Property Network Protocol

**Target:** only after real external pilot acceptance.

## Slice VP1 — Core Object Schemas

- property identity;
- issuer metadata;
- evidence;
- manifest;
- request;
- receipts;
- checkpoint;
- status/errors.

## Slice VP2 — Canonical Encoding / Crypto Envelope

Deterministic bytes + algorithm agility.

## Slice VP3 — Reference Verifier

Open candidate.

## Slice VP4 — Sandbox Reference Issuer

Synthetic only.

## Slice VP5 — Test Vectors / Conformance CI

Independent reproducibility.

## Slice VP6 — Profile Registry

Machine-readable.

## Slice VP7 — TypeScript + Python SDK

Only after core semantics stable.

## Slice VP8 — Independent Implementation

Required before mature interoperability claim.

### Adoption gate

Do not say "industry standard" until there is:

- real owner flow;
- real institutional verifier;
- independent implementation;
- repeated cross-system verification.

---

# 16. Cross-cutting architecture workstreams

These are not separate products. Every wave must reuse them.

## 16.1 Authority registry

Maintain explicit authority map:

- domain;
- canonical writer;
- read projections;
- external source;
- mutation boundary.

CI should prevent new parallel authorities.

## 16.2 Domain Outbox

All important cross-domain recomputations use committed events/outbox.

No UI-driven hidden recompute authority.

## 16.3 Idempotency

Required for:

- canonical mutations;
- institutional requests;
- artifact issuance;
- webhooks;
- reservations;
- approval actions.

## 16.4 Temporal/version semantics

Standardize:

- `effective_at`;
- `observed_at`;
- `recorded_at`;
- `source_cutoff`;
- `superseded_at`;
- snapshot/version IDs.

## 16.5 Provenance

Every derived fact should expose:

- source;
- source version;
- derivation policy;
- freshness;
- original/derived;
- current/superseded/revoked.

## 16.6 Search

Extend existing search surface incrementally:

projects/rooms/chat
-> documents/issues/RFI/assets
-> property passport
-> decisions
-> trust/action
-> owner portfolio.

Do not create multiple competing search systems.

## 16.7 Calm OS / Responsive UX

Every new surface must support:

- phone;
- tablet portrait;
- tablet landscape;
- desktop;
- large monitor.

Same business truth, different projection.

## 16.8 Observability

Each background process requires:

- queue lag;
- retry;
- DLQ;
- recompute latency;
- stale snapshot metric;
- error reason;
- correlation/request ID.

---

# 17. Migration discipline

For every new wave:

1. additive migration;
2. PostgreSQL exact migration test;
3. ORM/schema drift test;
4. backfill if needed;
5. rollback/forward strategy documented;
6. no history rewrite;
7. no SQLite-only acceptance.

High-value immutable objects should prefer append/supersede over destructive update.

---

# 18. API discipline

Every API slice requires:

- canonical authority identified;
- ACL;
- idempotency for writes;
- versioning;
- pagination for collections;
- stable error model;
- no existence leaks;
- source/freshness metadata for derived projections.

External/public APIs additionally require:

- rate limits;
- replay protection;
- explicit versions;
- audit.

---

# 19. CI ladder

## Tier 0 — Static / policy

- lint/typecheck;
- dependency/security;
- schema contract;
- forbidden authority duplication;
- documentation contract where required.

## Tier 1 — Domain

Focused unit/integration tests for changed domain.

## Tier 2 — PostgreSQL

Real transactional semantics:

- concurrency;
- idempotency;
- constraints;
- migrations;
- outbox.

## Tier 3 — Cross-domain

Event/recompute/authority boundaries.

## Tier 4 — Golden Paths

Human end-to-end flows.

## Tier 5 — Responsive/browser

Phone/tablet/desktop.

## Tier 6 — Failure/recovery

- provider outage;
- worker restart;
- stale source;
- duplicate webhook;
- offline queue;
- status service unavailable.

## Tier 7 — Pilot evidence

Measured human/operational value.

A capability is not "done" merely because Tier 1 passes.

---

# 20. PR slicing rules

Each implementation PR should ideally own one bounded invariant.

Good examples:

- property identity schema + API;
- installed asset lineage;
- trust requirement evaluator;
- recommendation dedupe;
- closure predicate for maintenance;
- service-visit compatibility evaluator;
- provider capacity freshness;
- lifecycle cost allocation;
- baseline freeze;
- IC conditional approval;
- snapshot delta;
- institution signed request;
- verifier canonicalization vector.

Avoid PRs that introduce:

`new schema + new optimizer + new UI + new external integration`

in one merge.

---

# 21. Execution-status taxonomy

Every roadmap item must be tagged:

### LIVE
Merged on main and production/release evidence exists.

### QUALIFIED
Exact-head tests green, pending merge/deploy.

### PARTIAL
Some canonical foundation exists, but named capability is incomplete.

### RESEARCH
Contract/docs only.

### BLOCKED
Cannot proceed because prerequisite gate is not green.

### PILOT
Implemented but commercial/operational claim not yet validated.

No other ambiguous status words.

---

# 22. Current status by strategic layer

| Layer | Current status | Immediate blocker |
|---|---|---|
| Core project/payment/docs/warranty | LIVE/PARTIAL by domain | #683 governance admission before merge of qualified release contour |
| Security/admission #683 | QUALIFIED / BLOCKED | mandatory second-agent review cannot authenticate: Anthropic credential absent |
| Participant PostgreSQL race fixture #699 | QUALIFIED | exact head `019322837…`: participant PostgreSQL 37/37 + complete workflow set GREEN |
| Verified Execution #668 | QUALIFIED | proven on #696 and integrated #698; waits for #683 admission + real merge path |
| Golden Paths GP1–GP8 | QUALIFIED | current #695/#698 exact contours GREEN; API 12/12, mobile-web 8/8; waits for #683 admission |
| Capability-aware operational context #700 | QUALIFIED | exact `c305be76…`: 7 focused cases + backend 1651/30 + Playwright/mobile/spec/security/readiness GREEN |
| Action Responsibility v1 + Home #701 | QUALIFIED | exact `f0fd7549…`: focused 2/2 + backend 1653/30 + Playwright/mobile/readiness/policy GREEN |
| Repair responsibility #702 | QUALIFICATION IN PROGRESS | stacked five-file Repair surface on #701; exact-head CI pending |
| Capability-aware UX / Action Responsibility / Action Queue v2 | QUALIFIED | integrated #695/#698 evidence-only contour; waits for admitted merge path |
| Property Passport | RESEARCH/PARTIAL foundations | Gate 0 + identity/asset schema |
| Decision Ledger | RESEARCH | property/evidence foundation |
| Trust Matrix | RESEARCH | Passport/history/policy engine |
| Action Engine | RESEARCH | Trust Matrix |
| Intervention Optimizer | RESEARCH | Action Engine |
| Operations Network | RESEARCH | Optimizer + service/provider data |
| Lifecycle Intelligence | RESEARCH | operations history + costs |
| Capital Strategy | RESEARCH | lifecycle + capacity/lead time |
| Portfolio / IC OS | RESEARCH | capital actual-vs-plan + Decision Ledger |
| Owner Digital Twin | RESEARCH | portfolio governance |
| External Institutional Network | RESEARCH | Owner Twin + issuer/status |
| Verified Property Protocol | RESEARCH | external pilots/adoption |

---

# 23. Calendar view — 2026–2028

These are target planning windows, not promises. Gates override dates.

## 2026 Q4

- close #683;
- requalify/merge #668;
- Golden Paths full exact-head;
- capability-aware UX;
- Property Identity;
- Installed Asset Registry;
- Decision Ledger foundation.

## 2027 Q1

- Verified Building History;
- Trust Matrix v1;
- Trust Exchange runtime profiles;
- issuer/key/status lifecycle;
- Action Engine v1.

## 2027 Q2

- Recovery Plan;
- Intervention Optimizer;
- Service Visit Bundling pilot;
- deterministic service demand;
- provider capacity.

## 2027 Q3

- parts availability;
- routing;
- maintenance campaigns;
- recall blast radius;
- Lifecycle Event Ledger.

## 2027 Q4

- deterministic lifecycle accounting;
- cohort metrics;
- Repair vs Replace;
- predictive backtesting only if data allows.

## 2028 H1

- 5-year CapEx;
- replacement waves;
- actual-vs-plan;
- portfolio objectives/scenarios;
- IC decision packs.

## 2028 H2

- Owner Digital Twin;
- capital/funding reconciliation;
- IC delta/reconciliation workbench;
- first institutional pilot;
- protocol core only if pilot semantics have stabilised.

---

# 24. Pilot gates

## Property Care pilot

Need:

- installed asset coverage;
- maintenance rules;
- provider/service workflow;
- evidence completion.

Success metrics:

- on-time maintenance;
- repeat visits;
- evidence completeness;
- remediation time.

## Lifecycle pilot

Need:

- one repeated asset family;
- reconciled costs;
- multi-year history if possible.

Success:

- coverage;
- reproducible cohorts;
- useful repair/replace comparison.

## Capital pilot

Need:

- real 5-year plan;
- approved baseline;
- actuals.

Success:

- preparation time;
- variance quality;
- unfunded mandatory visibility.

## IC/Owner pilot

Need:

- 10–30 properties;
- quarterly committee;
- actual capital process.

Success:

- pack preparation time;
- reconciliation defects;
- decision traceability;
- conditions tracked.

## Institutional pilot

Need:

- real insurer or lender/DD partner;
- explicit profile;
- owner consent;
- bounded data room.

Success:

- fewer repeated requests;
- shorter preparation;
- verification reliability;
- no privacy leakage.

---

# 25. Production/adoption gates

## Production capability gate

Requires:

- schema/API;
- ACL;
- idempotency;
- PostgreSQL;
- Golden Path where user-critical;
- responsive UX;
- observability;
- failure recovery;
- documentation.

## Commercial claim gate

Requires measured pilot evidence.

Examples not allowed before proof:

- "reduces maintenance cost by X%";
- "speeds refinancing by Y days";
- "reduces repeat visits by Z%".

## Network gate

Institutional network is real only when an external party actually uses it.

## Standard gate

Protocol is a mature interoperability claim only when independent implementations verify each other.

---

# 26. What should NOT be built yet

Until lower gates are green, defer:

- probabilistic predictive maintenance;
- stochastic CapEx;
- open provider marketplace;
- universal asset/property health score;
- external partner directory;
- certification marketing;
- industry-standard marketing;
- advanced DID/VC-only dependency;
- autonomous capital allocation;
- autonomous institutional decisions.

---

# 27. Immediate next execution queue

This is the strict near-term sequence from today's repository state:

```
1. #683 exact-head admission
   -> restore Anthropic second-agent credential/workload identity
   -> rerun mandatory review
   -> APPROVE + required checks/threads clean
   -> merge exact head

2. #699 participant PostgreSQL race fixture
   -> exact-head CI GREEN
   -> keep as bounded post-admission merge candidate if #683 still contains the stale fixture

3. capture new main SHA after #683

4. integrate already-qualified release contour
   -> Verified Execution proof from #696/#698
   -> Golden Paths GP1–GP8 from #695/#698
   -> capability-aware UX / Action Responsibility / Action Queue v2
   -> use real bounded merge PRs; evidence-only #695/#696/#698 are never merged
   -> re-run exact-head CI after each bounded merge slice

5. close current release contour
   -> API 12/12
   -> mobile-web 8/8
   -> backend-complete / PostgreSQL / Playwright / security / readiness GREEN
   -> no second-agent or required-policy red

6. create implementation epic/branch for Wave 1
   -> Property Identity
   -> Installed Asset Registry
   -> Verified Building History
   -> Decision Ledger

7. only after Wave 1 evidence
   -> Trust Matrix v1
```

This queue supersedes any temptation to implement Optimizer, Owner Twin or Protocol runtime early.

---

# 28. Definition of Done for this Strategic Execution Map

The map remains useful only if updated whenever:

- a prerequisite PR merges;
- a layer moves RESEARCH -> PARTIAL/QUALIFIED/LIVE;
- a pilot produces evidence;
- a dependency changes;
- a contract is superseded;
- actual dates materially diverge.

Every update must change the status table and immediate execution queue.

The north-star discipline is:

`do not confuse architecture depth with implementation progress`.

Renova should now build downward-to-upward through this DAG, proving each authority and data layer before using it as a dependency for the next.
