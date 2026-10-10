# Renova — Property Intervention Optimizer Contract

**Date:** 2026-10-08  
**Status:** RESEARCH / EXPLAINABLE RECOVERY OPTIMIZATION CONTRACT  
**Implementation gate:** after #683 admission and #668 Verified Execution Record requalification.  
**Depends on:** Property Trust Matrix + Property Action Engine.  
**Authority rule:** optimization proposes an ordered recovery plan; canonical Renova domains remain authoritative for execution, acceptance, payment, inspection, service, warranty and access.

## 1. Purpose

Property Action Engine answers:

`what actionable requirements exist, why they matter, what canonical action can address them, and what evidence closes them?`

Property Intervention Optimizer answers the next question:

`given several open blockers/actions and real operational constraints, what recovery plan should the user consider first, what can be safely bundled, what becomes unblocked, and why?`

It is a decision-support and planning layer, not an autonomous dispatcher.

Canonical flow:

```
active Action Engine recommendations
-> canonical linked actions
-> constraints / dependencies / windows / costs / provider capability
-> feasible intervention candidates
-> service-visit bundles
-> scenario evaluation
-> explainable Recovery Plan
-> human approval / canonical scheduling
-> execution in canonical domains
-> evidence / closure predicates
-> Trust Matrix recompute
```

## 2. Non-authority rule

The Optimizer must not become authority for:

- work-order state;
- service completion;
- contractor qualification;
- inspection acceptance;
- payment;
- warranty decision;
- recall remedy;
- ACL/access;
- source admission;
- Trust Matrix closure;
- transfer dossier issuance.

It reads canonical state and proposes plans.

## 3. Optimization unit

The optimizer operates over **intervention candidates**.

An intervention candidate references:

- property/project;
- one or more active Action Engine recommendations;
- canonical action type;
- subject asset/room/system;
- dependency set;
- due-date source;
- criticality band;
- required capability/qualification;
- expected visit/task duration where known;
- access/window constraints;
- provider options where known;
- expected direct cost/range where sourced;
- disruption class;
- required evidence outputs;
- affected Trust Matrix requirements/dimensions.

Unknown values remain unknown. Do not fabricate estimates.

## 4. Hard constraints

A plan is infeasible if any hard constraint fails.

Examples:

- provider lacks required trade/certification;
- official recall remedy requires an authorised network;
- action dependency not completed;
- required access window unavailable;
- pinned appointment conflicts;
- property/room access denied;
- required asset identity unresolved;
- work cannot occur before source/inspection/RFI outcome;
- policy forbids bundling;
- evidence producer must be independent;
- jurisdiction/contract requires separate inspection;
- safety rule forbids simultaneous tasks;
- tenant/owner blackout window;
- part/material unavailable where availability is authoritative.

Hard constraints cannot be traded away for lower cost or fewer visits.

## 5. Soft objectives

Within the feasible set, the optimizer may compare plans across explicit objectives:

- reduce critical blockers sooner;
- reduce transfer/insurance verification blockers sooner;
- reduce overdue mandatory obligations;
- minimise number of site visits;
- minimise total expected cost;
- minimise disruption/access events;
- minimise calendar span;
- minimise repeated setup/travel;
- maximise multi-requirement evidence yield;
- preserve provider continuity where useful;
- respect owner-selected preferences.

There is no universal hidden score.

Every generated plan must expose the objective profile used.

## 6. Lexicographic safety ordering

Default planning must respect this precedence unless a governed policy says otherwise:

1. immediate safety / official recall;
2. profile-blocking critical requirement;
3. overdue mandatory obligation;
4. hard contractual/warranty deadline;
5. transfer/verification blocker;
6. operational efficiency;
7. convenience/cost optimisation;
8. documentation improvement.

A cheap plan cannot outrank a required safety action solely because it saves money.

## 7. Service Visit Bundling

Bundling is a first-class optimisation mechanism.

One visit may combine multiple actions when all of the following are true:

- compatible provider capabilities;
- compatible location/property access;
- compatible time window;
- dependencies permit same-visit ordering;
- no independence requirement is violated;
- duration fits the service window;
- required materials/tools are available;
- evidence can be captured separately for each requirement;
- canonical action identities remain distinct where domains require them.

Example:

one qualified boiler visit may include:

- scheduled maintenance;
- commissioning-data refresh;
- installed-model verification;
- warranty/service-status evidence capture;
- closure evidence for several transfer-readiness requirements.

The visit is one operational bundle, not one merged authority record.

## 8. Bundle exclusion rules

Do not bundle when:

- inspection must be independent from remediation;
- warranty policy requires manufacturer/authorised partner;
- recall remedy mandates a different provider;
- one action requires destructive access incompatible with another;
- contamination/safety sequence requires separation;
- provider conflict-of-interest exists;
- evidence source classes require different issuers;
- one task may invalidate evidence for another unless sequence is controlled;
- customer/tenant explicitly forbids combined scope.

## 9. Intra-visit sequencing

Bundled plans may contain an ordered mini-DAG:

```
identify asset
-> verify applicability
-> perform maintenance
-> capture measurements
-> remediate defect
-> final evidence capture
```

A same-day bundle is valid only when every dependency edge is satisfiable inside the visit.

## 10. Provider capability model

Provider suitability is a constraint input, not a popularity score.

Candidate facts may include:

- trade/service capability;
- qualification/certification;
- manufacturer authorisation;
- supported asset categories;
- geography;
- service windows;
- independence role;
- verified service history;
- evidence-producing capability;
- current availability;
- quoted price/range where sourced.

Do not infer certification or availability from generic profile text.

## 11. Cost model

Cost may come from:

- accepted quote;
- framework rate;
- catalogue/service rate;
- historical internal actuals where policy permits;
- owner-entered planning estimate.

Every cost stores:

- source;
- currency;
- gross/net/VAT semantics where relevant;
- validity date;
- range/uncertainty if not fixed;
- inclusions/exclusions.

Unknown cost is not zero.

## 12. Time model

Time inputs may include:

- authoritative appointment slot;
- provider availability;
- estimated duration;
- dependency completion;
- delivery/part ETA;
- access window;
- due date;
- property blackout period.

Unknown duration is not treated as instant.

## 13. Disruption model

Optional planning attribute:

- no access disruption;
- room-level access;
- system shutdown;
- noisy/dusty work;
- water/power/HVAC interruption;
- tenant/owner presence required;
- whole-property access.

This may be used to reduce repeated disruption, but cannot override hard constraints.

## 14. Intervention graph

Build a graph containing:

- requirement nodes;
- recommendation nodes;
- canonical action nodes;
- dependency edges;
- provider/capability constraints;
- appointment/window constraints;
- evidence-output requirements;
- target profile blockers.

The graph is a projection. Source domain IDs remain canonical.

## 15. Critical path

The optimizer may identify a **recovery critical path**:

actions whose completion gates the earliest feasible readiness for a target profile.

Examples:

- transfer readiness;
- insurer evidence profile;
- warranty reinstatement;
- maintenance-current state.

Critical path is profile-specific and snapshot-specific.

Do not claim a permanent property-wide critical path.

## 16. What-if scenarios

Supported scenario parameters may include:

- target date;
- maximum budget;
- maximum number of visits;
- preferred providers;
- preserve existing appointments;
- minimise disruption;
- fastest transfer readiness;
- fastest critical-risk resolution;
- exclude unavailable provider;
- assume part arrives on a sourced date;
- move a non-critical action outside current window.

What-if never mutates canonical state.

## 17. Scenario output

Each scenario returns:

- feasibility;
- explicit assumptions;
- hard-constraint failures;
- ordered interventions;
- bundled visits;
- dependency graph;
- critical path;
- estimated calendar span where inputs support it;
- sourced cost/range where inputs support it;
- target blockers expected to become *eligible for re-evaluation*;
- unresolved blockers;
- uncertainties;
- human decisions required.

Do not say a requirement "will be resolved" before closure evidence and recompute.

## 18. Plan comparison

Compare plans on transparent dimensions.

Example:

| Dimension | Plan A | Plan B |
|---|---:|---:|
| Feasible | yes | yes |
| Critical blocker completion | earlier | later |
| Site visits | 2 | 3 |
| Expected sourced cost | lower | higher |
| Transfer blockers eligible for re-evaluation | 4 | 4 |
| Disruption events | 1 | 3 |
| Provider changes | 0 | 2 |
| Main uncertainty | part ETA | provider slot |

No single opaque "Best Plan Score" is required.

## 19. Recommendation wording

The UI may say:

- "Рекомендуемый порядок";
- "Самый быстрый из допустимых сценариев";
- "Меньше выездов при том же наборе обязательных работ";
- "Дешевле по подтверждённым котировкам";
- "Сначала закрывает transfer blocker".

It must not say:

- "AI decided";
- "guaranteed ready";
- "guaranteed savings";
- "all issues will be closed".

## 20. Explainability receipt

Every proposed plan stores/reconstructs:

- input snapshot IDs;
- Action Engine recommendation IDs;
- profile/policy version;
- objective profile;
- hard constraints;
- provider facts used;
- cost/time source facts;
- bundles considered;
- bundles rejected + reasons;
- selected ordering;
- alternatives considered;
- generated_at;
- optimizer version.

This makes planning reproducible and auditable.

## 21. Human approval boundary

The optimizer may:

- propose plan;
- propose visit bundle;
- prefill scheduling scope;
- prefill provider RFQ/service request;
- draft owner/manager approval package.

It may not:

- schedule a binding visit without authorised action;
- accept quote;
- issue purchase/service order;
- approve payment;
- accept work;
- waive requirement;
- change provider ACL.

## 22. Pinned items

Users may pin:

- existing appointment;
- provider;
- deadline;
- action order;
- "must be separate";
- "must be same visit";
- budget ceiling;
- blackout window.

Pinned choices become scenario constraints and must be visible in the result.

If pins make the plan infeasible, show exactly why.

## 23. Partial feasibility

If the full target profile is infeasible, return the best transparent partial plan:

- feasible actions now;
- blockers preventing full plan;
- missing source/decision;
- earliest next re-planning trigger.

Do not suppress useful work because one blocker is unresolved.

## 24. Replanning triggers

Recompute the plan when meaningful inputs change:

- recommendation added/resolved/reopened;
- dependency state changed;
- quote updated/expired;
- provider availability changed;
- appointment changed;
- part availability/ETA changed;
- recall/source status changed;
- owner constraint/pin changed;
- profile/policy version changed.

Avoid full re-optimisation on irrelevant UI events.

## 25. Stability / plan churn

Users should not see a completely different plan for trivial input changes.

Use plan-stability rules:

- preserve pinned and committed appointments;
- preserve already-approved provider where still feasible;
- prefer minimal change between equivalent plans;
- explain material reorder reason.

Do not optimise away human commitments for marginal theoretical gain.

## 26. Concurrency

When multiple actors edit planning inputs:

- use versioned scenario snapshot;
- detect stale plan approval;
- require refresh/review when critical inputs changed;
- canonical scheduling mutation checks current constraints again.

A stale scenario cannot silently book against superseded availability.

## 27. Offline behavior

Allowed offline:

- view cached plan;
- compare cached scenarios;
- set local draft preferences/pins.

Not final offline:

- authoritative availability;
- quote validity;
- booking;
- provider assignment;
- plan approval that creates canonical mutation.

UI must show snapshot age.

## 28. Security / privacy

- provider sees only scope they are authorised to quote/serve;
- institutional target profile does not expose unrelated owner/private recommendations;
- hidden asset/location details are not leaked through optimisation explanations;
- price/quote visibility follows commercial ACL;
- tenant/private blackout reasons may be redacted while preserving scheduling constraint.

## 29. AI boundary

AI may help:

- explain trade-offs;
- summarise why actions were bundled;
- draft scenario narrative;
- suggest which scenario to inspect;
- extract candidate preferences from user text into a reviewable form.

AI may not be the optimisation authority for hard constraints.

Feasibility and ordering rules that affect critical requirements must be deterministic/reproducible.

## 30. Deterministic engine baseline

Before any learned optimiser, implement a deterministic baseline:

1. filter infeasible actions/providers;
2. build dependency DAG;
3. assign mandatory priority bands;
4. derive target-profile blockers;
5. enumerate compatible bundles within bounded search;
6. schedule pinned/critical items first;
7. optimise selected explicit objectives;
8. emit alternatives and reasons.

A heuristic is acceptable if deterministic and testable.

## 31. Solver evolution

Possible later evolution:

- constraint programming;
- mixed-integer optimisation;
- bounded vehicle/service routing for portfolios;
- probabilistic duration ranges;
- stochastic scenario simulation.

Adopt only when measured value justifies complexity.

No solver may bypass business-policy validation.

## 32. Portfolio mode

For property managers, optimiser may consider:

- several properties;
- provider route/geography;
- shared service windows;
- framework rates;
- recurring maintenance batches;
- urgent blockers;
- staff availability.

Portfolio optimisation must keep each property's evidence and closure predicates separate.

## 33. Service Visit Bundling metrics

Measure:

### Visits avoided

`baseline_unbundled_visits - executed_bundled_visits`

Only count against a defined baseline.

### Bundle success rate

`bundled_visits_that_produced_all_planned_evidence / executed_bundled_visits`

### Bundle closure yield

number of requirements whose closure predicates pass after a bundled visit.

### Repeat-visit rate

additional visit required because planned evidence/work was incomplete.

### Disruption events avoided

compare against equivalent unbundled executed plan when baseline exists.

## 34. Recovery metrics

- time to first critical blocker remediation;
- time to target-profile readiness;
- sourced/actual cost delta;
- plan churn after approval;
- stale-plan rejection rate;
- provider no-fit rate;
- infeasible-scenario rate;
- closure failure after planned intervention;
- replan count per recovery episode.

## 35. Counterfactual integrity

Do not claim savings from a hypothetical alternative unless:

- baseline is explicit;
- both plans use comparable sourced inputs;
- assumptions are recorded.

Use language like "estimated difference under current inputs".

## 36. Failure handling

If optimisation fails:

- keep Action Engine queue usable;
- show previous plan as stale, not current;
- allow manual canonical action execution;
- log reason;
- retry safely.

Optimizer outage must never block mandatory remediation.

## 37. API projection

Candidate read models:

- `GET /properties/{id}/intervention-plan`
- `POST /properties/{id}/intervention-scenarios`
- `GET /intervention-scenarios/{id}`
- `POST /intervention-scenarios/{id}/approve`

Approval creates reviewed intents into canonical domains; it does not directly mutate domain tables.

Exact route design belongs to implementation.

## 38. Test matrix

Required tests:

- hard-constraint violation;
- dependency ordering;
- cycle rejection inherited from Action Engine;
- same-provider compatible bundle;
- incompatible certification;
- independent inspection must remain separate;
- same-visit ordered dependency;
- unavailable provider;
- unknown cost remains unknown;
- expired quote excluded;
- pinned appointment preserved;
- conflicting pins -> infeasible with reason;
- faster-vs-cheaper scenario;
- critical blocker cannot be demoted by cost;
- partial-feasibility output;
- stale scenario approval rejected;
- policy/profile version change triggers replan;
- one bundled visit -> independent closure predicates;
- closure failure after execution leaves recommendation open;
- optimizer outage does not block canonical actions.

## 39. UX surfaces

### Owner / Property Care

Show:

- "Что мешает сейчас";
- "Рекомендуемый порядок";
- proposed grouped visits;
- date/cost only when sourced;
- why each action matters;
- what evidence will be needed;
- alternative scenarios.

### Manager

Show:

- multi-property queue;
- provider/capability fit;
- deadline conflicts;
- visit consolidation opportunities;
- scenario comparison;
- approval/audit state.

### Provider

Show only:

- authorised bundled scope;
- required outputs/evidence;
- time/access constraints;
- accepted commercial terms after canonical approval.

No Trust Matrix internals that are not needed for service execution.

## 40. Commercial value

**Property Care**
- fewer unnecessary visits;
- clearer maintenance/service planning;
- reusable evidence capture.

**Property Trust / Transfer**
- faster blocker-remediation planning;
- explicit path to re-evaluation/readiness.

**Enterprise**
- portfolio visit consolidation;
- provider capacity planning;
- repeatable recovery playbooks;
- auditable what-if planning.

Commercial claims must be measured in pilots before publication.

## 41. Anti-patterns — REJECT

- opaque universal optimizer score;
- "cheapest wins" regardless of criticality;
- fabricated cost/duration/availability;
- auto-booking without approval;
- one bundled record replacing separate canonical actions;
- bundling inspection with remediation where independence is required;
- AI changing hard constraints;
- treating predicted closure as actual closure;
- hiding infeasible constraints;
- re-planning committed appointments for tiny theoretical gain;
- blocking manual remediation because solver is unavailable.

## 42. Definition of Done

Implementation is not complete until:

- optimisation is a projection over Action Engine/canonical domains;
- hard constraints are explicit/tested;
- mandatory criticality precedes efficiency objectives;
- objective profile is visible;
- Service Visit Bundling preserves independent closure predicates;
- provider capability/availability facts are source-labelled;
- unknown cost/time stays unknown;
- pinned human commitments are respected;
- alternatives and rejected bundles are explainable;
- stale plan approval is rejected;
- canonical mutations are revalidated at commit time;
- outage falls back to Action Engine/manual domain execution;
- metrics distinguish estimated from realised value.

## 43. Sequencing

1. deterministic intervention graph;
2. hard-constraint evaluator;
3. target-profile critical path;
4. Service Visit Bundling v1;
5. transparent scenario comparison;
6. owner/manager approval surface;
7. replan triggers + stale-plan protection;
8. pilot instrumentation;
9. only then advanced solver/portfolio routing if measured demand proves it.
