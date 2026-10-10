# Renova — Property Operations Network Contract

**Date:** 2026-10-08  
**Status:** RESEARCH / PORTFOLIO OPERATIONS CONTRACT  
**Implementation gate:** after Property Intervention Optimizer baseline is qualified and current admission gates are closed.  
**Depends on:** Property Trust Matrix, Property Action Engine, Property Intervention Optimizer, Property Passport / installed-asset history, canonical Service/Inspection/Warranty/Issue domains.  
**Authority rule:** the network forecasts and coordinates demand/capacity; canonical Renova domains remain authoritative for work, appointments, acceptance, payment, evidence, access and trust closure.

## 1. Purpose

Property Intervention Optimizer plans one property's recovery efficiently.

Property Operations Network extends that logic across a real operating network:

```
property portfolio
-> installed assets
-> service obligations
-> expected intervention demand
-> provider capabilities/capacity
-> parts/material availability
-> geography/access windows
-> maintenance/recall/transfer priorities
-> portfolio routing/campaigns
-> canonical execution
-> evidence
-> measured economics
```

The goal is to move Renova from reactive issue handling toward a verified, explainable operating layer for property lifecycle management.

## 2. Core principle: forecast is not authority

The network must distinguish:

- observed fact;
- scheduled obligation;
- policy-derived due event;
- deterministic forecast;
- probabilistic forecast;
- scenario assumption;
- confirmed appointment;
- executed work;
- admitted evidence.

A forecast may trigger planning attention.

It must not silently become:

- an appointment;
- a work order;
- a purchase;
- a safety conclusion;
- a payment;
- a completed maintenance event.

## 3. Network graph

The network graph may contain:

### Property nodes
- property;
- project;
- building;
- unit;
- floor;
- room/zone.

### Asset nodes
- installed asset;
- system;
- product/material assembly;
- warranty;
- maintenance rule;
- recall applicability state.

### Service nodes
- service obligation;
- intervention candidate;
- service case;
- inspection;
- warranty case;
- provider;
- provider capability;
- provider territory;
- provider capacity slot.

### Supply nodes
- required part;
- replacement asset;
- consumable;
- supplier;
- stock observation;
- lead-time observation;
- reservation/order where canonical.

### Evidence nodes
- required evidence output;
- admitted source;
- verification artifact;
- commissioning/service record.

### Operational edges
- installed_at;
- serviced_by;
- qualified_for;
- requires_part;
- blocked_by;
- due_under;
- located_in;
- can_route_with;
- evidence_for;
- affected_by_recall;
- transfer_blocker_for.

The graph is a projection over canonical domain facts, not a replacement database of authority.

## 4. Asset / Service Demand Forecast

The forecast estimates upcoming operational demand over explicit horizons.

Supported horizons may include:

- 7 days;
- 30 days;
- 60 days;
- 90 days;
- seasonal window;
- owner/manager-selected horizon.

Candidate demand sources:

- manufacturer maintenance interval;
- warranty condition;
- official recall;
- regulation/policy;
- known inspection cycle;
- unresolved Action Engine recommendation;
- approved Recovery Plan;
- transfer target date;
- service history;
- explicit owner request.

No due event should be invented from generic AI inference.

## 5. Forecast classes

### Class A — deterministic scheduled demand
Known due date/window from a source.

Example:
annual boiler service due on a source-backed date.

### Class B — bounded policy demand
Due window is derived from a policy rule.

Example:
inspection required within a defined interval after installation.

### Class C — conditional demand
Occurs if another event happens.

Example:
reinspection after remediation.

### Class D — probabilistic demand
Predicted risk of future service need from historical/telemetry patterns.

This class is optional and must remain labelled as predictive.

Class D may not outrank a mandatory Class A/B critical obligation.

## 6. Forecast confidence and coverage

Every forecast output must expose:

- source coverage;
- assets included;
- assets excluded;
- unknown maintenance schedule count;
- stale source count;
- forecast class;
- model/rule version;
- time generated.

Do not present "47 services next month" without also allowing inspection of what those 47 represent and what is missing.

## 7. Demand aggregation

Aggregate by:

- property;
- geography;
- asset class;
- manufacturer;
- service type;
- provider capability;
- criticality;
- due window;
- warranty/recall;
- transfer blocker;
- required evidence class.

Aggregation should preserve drill-down to individual obligations.

## 8. Provider Capacity Graph

Provider capacity is represented as facts and reservations, not assumptions.

Provider capacity dimensions may include:

- capability/trade;
- certification;
- manufacturer authorisation;
- geography/territory;
- crew count where sourced;
- service duration class;
- shift/calendar;
- available slots;
- reserved slots;
- travel constraints;
- independence requirements;
- evidence-producing capability.

Capacity values must have provenance and freshness.

Unknown capacity remains unknown.

## 9. Capacity states

Possible planning states:

- confirmed_available;
- quoted_available;
- tentative;
- unavailable;
- stale;
- unknown.

Only confirmed/quoted availability may support strong scheduling claims.

Tentative availability must be visibly marked.

## 10. Capability matching

Provider matching must enforce:

- required trade;
- certification;
- manufacturer authorisation;
- jurisdictional requirement;
- independence/conflict rule;
- evidence requirement;
- property access rule;
- service geography;
- commercial eligibility where applicable.

A high rating or prior usage cannot substitute for a missing mandatory qualification.

## 11. Capacity bottleneck detection

The network may surface:

- demand exceeds known qualified capacity;
- no qualified provider known;
- provider concentration risk;
- all qualified capacity occurs after deadline;
- travel/geography makes current plan infeasible;
- simultaneous recall wave exceeds local capacity;
- part constraint makes provider capacity irrelevant until supply clears.

These are planning warnings, not claims that work will fail.

## 12. Parts & Materials Availability

Represent supply requirements explicitly.

Candidate facts:

- part/SKU identity;
- compatible alternatives if formally approved;
- supplier;
- stock observation;
- reserved quantity;
- expected replenishment;
- lead-time source;
- quote validity;
- batch/serial applicability where relevant.

Unknown stock is not "available".

## 13. Supply source hierarchy

Prefer:

1. confirmed reservation/order;
2. current supplier stock response;
3. current catalogue/API availability;
4. recent accepted quote;
5. historical lead time;
6. planning estimate.

The UI must expose which level is being used.

## 14. Substitution boundary

Renova may suggest that an approved alternative exists only when backed by a valid source/policy.

AI cannot invent compatible replacement parts/materials.

Substitution may require:

- RFI;
- Submittal;
- engineering approval;
- manufacturer confirmation;
- warranty confirmation.

## 15. Parts-aware planning

An intervention may be:

- ready_to_schedule;
- schedule_after_part;
- part_at_risk;
- blocked_by_part;
- part_unknown.

Routing should not schedule a guaranteed-completion visit when required material availability is unknown unless policy allows diagnostic/preparatory work.

## 16. Portfolio Visit Routing

Portfolio routing optimises operational movement across several properties.

Inputs may include:

- property locations;
- provider start/end constraints;
- qualified scope;
- appointment windows;
- estimated task durations;
- parts readiness;
- criticality;
- access windows;
- travel-time provider;
- existing commitments.

Routing is subordinate to Intervention Optimizer hard constraints.

## 17. Route objective profiles

Examples:

### Critical-first
Earliest feasible completion of mandatory/critical obligations.

### Minimum visits
Reduce total site visits while preserving all constraints.

### Minimum travel
Reduce travel distance/time after criticality constraints.

### Minimum disruption
Group work by property/access event.

### Transfer acceleration
Prioritise actions that gate specific transfer-readiness profiles.

The objective profile must be explicit.

## 18. Travel-time truth

Travel duration must come from:

- configured routing provider;
- sourced historical actual;
- explicit planning estimate.

Do not infer precise travel times from straight-line distance.

If routing provider is unavailable:

- retain previous sourced observation as stale where policy permits;
- or show distance-only/unknown travel;
- do not fabricate minutes.

## 19. Route stability

Once visits are accepted/booked:

- preserve them when still feasible;
- reoptimise around them;
- avoid churn for marginal gains;
- show why a material route change is proposed.

## 20. Maintenance Campaigns

A campaign is a coordinated planning envelope around a cohort of obligations.

Examples:

- annual HVAC service month;
- smoke detector inspection campaign;
- warranty-end inspection campaign;
- seasonal heating readiness;
- portfolio water-leak sensor battery replacement.

Campaigns group demand for planning and communications.

They do not bulk-close obligations.

## 21. Campaign eligibility

A campaign cohort must be reproducible from explicit filters:

- asset class;
- maintenance rule;
- due window;
- geography;
- provider capability;
- warranty state;
- portfolio/account;
- policy/profile.

No opaque AI audience generation for mandatory operational work.

## 22. Campaign lifecycle

Candidate states:

- proposed;
- reviewed;
- approved;
- scheduling;
- active;
- completed;
- closed.

Each underlying service obligation retains canonical state.

## 23. Campaign controls

Support:

- target cohort;
- excluded properties/assets;
- target window;
- provider pool;
- required parts;
- communication template;
- evidence package;
- escalation policy;
- owner/tenant preferences;
- budget ceiling where authorised.

## 24. Recall Blast-Radius Response

A verified recall creates a controlled impact-analysis workflow.

Canonical chain:

```
official recall source
-> applicability rule
-> installed-asset candidate match
-> exact/uncertain/non-match classification
-> impacted-property cohort
-> severity/remedy preserved from source
-> provider/part capacity analysis
-> campaign/recovery plan
-> canonical inspection/service/replacement
-> evidence
-> asset/history update
-> Trust Matrix recompute
```

## 25. Recall match states

- exact_match;
- candidate_match_needs_confirmation;
- not_match;
- insufficient_identity;
- source_stale_or_revoked.

Candidate match must not be presented as confirmed impact.

## 26. Recall capacity crisis mode

If a recall affects more assets than known capacity can address by a source-backed deadline, surface:

- impacted count;
- confirmed vs candidate count;
- qualified provider capacity;
- required parts;
- deadline;
- infeasible remainder;
- recommended escalation options.

Renova must not invent alternative safety instructions.

## 27. Predictive Recovery Planning

Predictive Recovery Planning combines:

- forecasted due demand;
- open blockers;
- Intervention Optimizer constraints;
- provider capacity;
- supply availability;
- target profile dates.

It answers:

- what demand is likely/known to arrive;
- where future capacity shortfalls may occur;
- what can be pre-booked;
- what parts should be secured after approval;
- which deadlines are at risk;
- which intervention bundles are likely beneficial.

It remains scenario planning until canonical commitments exist.

## 28. Early reservation proposals

The system may propose:

- reserve service slot;
- request quote;
- request stock confirmation;
- reserve part;
- start owner access coordination.

Each proposal must identify:

- why now;
- consequence of delay;
- source-backed deadline/window;
- uncertainty;
- canonical action required.

No automatic commercial commitment.

## 29. Risk windows

Forecast risk states may include:

- capacity_risk;
- supply_risk;
- deadline_risk;
- access_risk;
- evidence_risk;
- provider_concentration_risk.

These are operational planning labels.

They are not safety or underwriting ratings.

## 30. Economics model

Measure actual operational economics, not marketing estimates.

Track:

- service visit cost;
- travel cost where available;
- labour/setup cost where available;
- part/material cost;
- repeat-visit cost;
- emergency premium;
- downtime/disruption proxy where defined;
- administrative coordination time where measurable.

Keep sourced/estimated/actual values distinct.

## 31. Baseline definitions

Savings require a baseline.

Allowed baseline examples:

- historical unbundled process;
- previous operating period;
- manually planned cohort;
- control portfolio/group;
- accepted pre-optimizer plan.

Record baseline version and inclusion rules.

## 32. Core realised metrics

### Visit consolidation rate
`1 - executed_visits / comparable_unbundled_visit_baseline`

### Repeat-visit rate
`repeat_visits_required / executed_visits`

### First-time evidence completeness
`visits_with_all_required_evidence / executed_visits`

### On-time maintenance completion
`obligations_completed_within_due_window / due_obligations`

### Capacity coverage
`demand_units_with_known_qualified_capacity / forecast_demand_units`

### Part-ready-at-visit rate
`visits_with_required_parts_ready / visits_requiring_parts`

### Route utilisation
Define only after a stable provider/time capacity denominator exists.

### Recovery lead time
`target_profile_ready_at - recovery_episode_started_at`

### Avoided emergency premium
Only measure when a comparable historical/control baseline exists.

## 33. Estimated vs realised economics

Every economic output must be tagged:

- forecast;
- quote;
- approved budget;
- committed;
- actual;
- reconciled.

Do not report forecast savings as realised savings.

## 34. Data freshness

Key freshness clocks:

- provider capacity;
- provider qualification;
- supplier stock;
- quote;
- route/travel observation;
- asset identity;
- maintenance policy;
- recall source;
- appointment;
- access window.

Stale inputs degrade planning confidence or invalidate feasibility according to policy.

## 35. Snapshot reproducibility

Each network plan/campaign/forecast stores:

- portfolio cut;
- asset graph version;
- Action Engine snapshot;
- optimizer version;
- provider capacity snapshot;
- parts availability snapshot;
- routing observation/version;
- policy/profile version;
- assumptions;
- generated_at.

A material historical recommendation must be reproducible.

## 36. Event-driven refresh

Meaningful triggers include:

- service completed;
- evidence accepted/rejected;
- new maintenance due;
- provider slot changed;
- provider qualification changed;
- supplier stock changed;
- part reserved;
- appointment changed;
- recall admitted/revoked/updated;
- asset identity changed;
- transfer target created/changed;
- owner access window changed.

Do not recompute the entire network for unrelated UI events.

## 37. Concurrency and reservations

Capacity/stock is inherently concurrent.

Required behavior:

- versioned availability;
- reservation expiry;
- compare-and-set/transactional reservation where canonical system permits;
- stale reservation detection;
- no silent overbooking;
- no double-counting one part reservation across plans.

Planning read models cannot guarantee reservation until canonical confirmation.

## 38. Failure isolation

If network forecasting/routing fails:

- canonical service/work continues;
- current appointments remain;
- Action Engine remains usable;
- previous plan is marked stale;
- mandatory remediation is not blocked.

If external stock/capacity provider fails, expose unavailable/stale status rather than assumed continuity.

## 39. Human operating roles

### Owner
- upcoming obligations;
- proposed grouped visits;
- access decisions;
- approval requests.

### Property manager
- portfolio demand;
- bottlenecks;
- campaigns;
- route/capacity conflicts;
- exceptions.

### Service coordinator
- provider fit;
- schedule;
- parts readiness;
- evidence requirements.

### Provider
- authorised assigned scope;
- route/appointment;
- required parts where relevant;
- evidence checklist.

### Enterprise operations
- portfolio forecast;
- provider concentration;
- SLA exposure;
- recall blast radius;
- realised economics.

Role projections must not expand ACL.

## 40. UX principle

The primary view should answer:

1. what operational demand is coming;
2. what is already committed;
3. where the network cannot currently satisfy the demand;
4. what decision is needed now;
5. what changes if we act.

Avoid a giant "control tower" full of decorative metrics.

## 41. Capacity calendar

A useful manager view may combine:

- due demand lanes;
- provider capacity lanes;
- part readiness;
- committed appointments;
- unscheduled critical obligations;
- transfer target dates.

Unknown/stale states must be visibly distinct from zero capacity/demand.

## 42. Exception-first operations

Default manager workflow:

```
normal scheduled work hidden/quiet
-> capacity shortfall
-> missed part
-> unqualified provider
-> appointment conflict
-> recall surge
-> access failure
-> evidence failure
-> manual resolution
```

The system should reduce attention load, not make managers inspect every ordinary visit.

## 43. Automation boundary

Allowed automation after explicit policies/permissions:

- draft campaign;
- draft route;
- propose visit consolidation;
- request non-binding availability;
- generate evidence checklist;
- generate reminders;
- trigger reforecast.

Requires human/canonical approval:

- book provider;
- accept quote;
- order/reserve charged material;
- change customer appointment;
- cancel visit;
- approve substitution;
- waive requirement;
- approve payment.

## 44. AI boundary

AI may:

- explain capacity bottlenecks;
- summarise campaign;
- draft outreach;
- cluster narrative reasons;
- surface anomalies for review.

AI may not:

- fabricate demand;
- infer provider certification;
- invent stock;
- invent recall applicability;
- bypass solver constraints;
- silently prioritise one customer/property for protected reasons;
- issue binding orders.

## 45. Fairness / allocation

When scarce capacity is allocated, ordering must come from explicit operational policy such as:

- safety/official recall;
- statutory deadline;
- contract SLA;
- transfer-critical deadline;
- first confirmed booking;
- documented enterprise policy.

Do not use hidden customer-value or opaque AI ranking for scarce mandatory service capacity.

## 46. Privacy

- portfolio routing should expose only necessary address/location details to assigned providers;
- exact occupancy/access notes are scoped;
- tenants do not see unrelated portfolio data;
- institutions see only purpose-specific trust information;
- supplier/provider analytics should avoid unnecessary owner identity exposure.

## 47. Security

Required:

- provider identity;
- capability verification provenance;
- signed/traceable appointment mutations;
- audit for reservation/booking/cancellation;
- scoped access;
- stale-token/session handling;
- idempotent booking/order intents;
- replay protection where external APIs require it.

## 48. Integration adapters

Possible adapter boundaries:

- provider calendar/field-service systems;
- routing providers;
- supplier/ERP/stock APIs;
- manufacturer warranty/recall sources;
- procurement/order systems;
- building-management/IoT observations where trustworthy;
- insurer/lender request profiles.

Adapters cannot become internal schema authority.

## 49. APIs / projections

Candidate surfaces:

- `GET /portfolios/{id}/service-demand-forecast`
- `GET /portfolios/{id}/capacity-gaps`
- `POST /portfolios/{id}/routing-scenarios`
- `POST /portfolios/{id}/maintenance-campaigns`
- `GET /recalls/{id}/blast-radius`
- `POST /recalls/{id}/response-scenario`
- `GET /operations/economics`

Write APIs should create reviewed intents into canonical domains.

## 50. Test matrix

Required:

- deterministic maintenance forecast;
- unknown maintenance schedule excluded/flagged;
- mandatory demand outranks predictive demand;
- provider capability mismatch;
- stale capacity;
- provider deadline bottleneck;
- exact vs candidate recall match;
- part unavailable;
- unknown stock not treated as available;
- part-ready route;
- appointment pin preserved;
- travel provider unavailable;
- routing fallback stays truthful;
- campaign cohort reproducible;
- campaign completion does not bulk-close obligations;
- scarce-capacity policy ordering;
- concurrent slot reservation;
- reservation expiry;
- stale scenario commit rejected;
- recall surge > available capacity;
- predicted demand never creates work automatically;
- network outage does not block canonical service;
- forecast vs actual economics remain separate.

## 51. Pilot design

Do not roll out advanced optimisation portfolio-wide first.

Pilot with a bounded cohort:

- one asset category;
- 20–100 properties;
- known maintenance schedule;
- small qualified provider pool;
- measurable historical baseline;
- clear evidence checklist.

Measure:

- planned vs actual demand;
- visits;
- repeat visits;
- first-time evidence completeness;
- on-time completion;
- coordinator time;
- sourced vs actual cost;
- user/provider objections.

Expand only if measured benefit is real.

## 52. Commercial packaging

### Property Care
- upcoming service forecast;
- maintenance planning;
- bundled visit proposals.

### Property Trust / Transfer
- target-date recovery capacity;
- transfer blocker scheduling;
- evidence readiness.

### Enterprise Operations
- portfolio capacity graph;
- campaigns;
- routing;
- provider bottlenecks;
- recall response;
- economics.

### Provider Network
Potential future module only after enough real supply/demand:
- qualified opportunity routing;
- schedule integration;
- evidence-standard compliance.

Do not build a marketplace before operational density exists.

## 53. Strategic moat

The defensible asset is not "AI scheduling".

It is the accumulated, permissioned operational graph:

```
installed asset identity
+ maintenance obligation
+ verified service history
+ provider capability
+ evidence quality
+ parts dependency
+ actual duration/cost
+ repeat-visit outcome
+ property/profile requirement
```

Over time this can improve planning quality while remaining evidence-grounded.

## 54. Anti-patterns — REJECT

- predictive maintenance presented as known failure;
- hidden provider ranking;
- fake stock/availability;
- automatic paid booking/order;
- bulk-close campaign;
- route optimisation that ignores qualifications;
- recall candidate shown as confirmed;
- savings without baseline;
- forecast savings shown as realised;
- control-tower vanity metrics;
- central network outage blocking local/canonical work;
- building marketplace supply before demand density exists.

## 55. Definition of Done

The first Property Operations Network release is not complete until:

- demand classes are explicit;
- deterministic obligations are separated from predictive demand;
- provider capability/capacity has provenance/freshness;
- parts availability has source semantics;
- route planning respects Intervention Optimizer hard constraints;
- campaigns preserve individual canonical obligations;
- recall exact/candidate states are distinct;
- scarce capacity allocation uses explicit policy;
- stale reservations/scenarios are rejected;
- forecast/quote/actual economics are separate;
- every savings claim has a baseline;
- canonical service remains usable if forecasting/routing fails;
- pilot metrics demonstrate whether the layer actually reduces operational friction.

## 56. Strict sequencing

1. Asset / Service Demand Forecast v1 — deterministic obligations only;
2. Provider Capability + Capacity Graph;
3. Parts & Materials Availability;
4. Portfolio Visit Routing with pinned commitments;
5. Maintenance Campaigns;
6. Recall Blast-Radius Response;
7. Predictive Recovery Planning;
8. realised economics instrumentation;
9. probabilistic demand only after enough actual history;
10. marketplace/provider-network economics only after demonstrated density.
