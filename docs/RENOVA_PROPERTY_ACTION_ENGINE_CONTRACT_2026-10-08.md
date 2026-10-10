# Renova — Property Action Engine Contract

**Date:** 2026-10-08  
**Status:** RESEARCH / REMEDIATION ORCHESTRATION CONTRACT  
**Implementation gate:** after #683 admission and #668 Verified Execution Record requalification.

## 1. Purpose

Property Trust Matrix identifies trust gaps and obligations.

Property Action Engine converts actionable findings into controlled remediation without creating a second task system.

Canonical loop:

```
Trust Matrix requirement result
-> recommendation
-> acknowledge/triage
-> create or link canonical domain action
-> execute in canonical domain
-> collect closure evidence
-> evaluate closure predicate
-> recompute Property Trust Matrix
-> resolve/supersede recommendation
```

## 2. Non-authority rule

The Action Engine is orchestration/projection only.

It must not become authority for:

- acceptance;
- payment;
- inspection result;
- RFI answer;
- Submittal approval;
- warranty closure;
- service completion;
- change order;
- team/ACL;
- canonical task/work-order state.

Those remain in their existing Renova domains.

## 3. Recommendation identity

Each recommendation has a deterministic identity derived from:

- property;
- policy/profile;
- requirement;
- subject entity;
- current root cause/source state.

Illustrative key:

`property_id | policy_id | requirement_id | subject_type | subject_id | cause_fingerprint`

The exact canonical encoding belongs to implementation.

## 4. Recommendation states

Allowed orchestration states:

- proposed;
- acknowledged;
- linked;
- snoozed;
- dismissed;
- invalidated;
- resolved;
- superseded.

These states do not duplicate the canonical execution entity's workflow state.

## 5. Action routing registry

Maintain a versioned registry mapping requirement/reason classes to canonical domain actions.

Illustrative entries:

| Requirement / reason | Canonical domain |
|---|---|
| missing inspection evidence | Inspection / Hold Point |
| unresolved defect/rework | Project Issue / Work Order |
| technical ambiguity | RFI |
| product/material approval missing | Submittal / Material Approval |
| maintenance overdue | Service Case / Work Order |
| warranty obligation | Warranty Issue / Service Case |
| confirmed product recall | Inspection / Service / Replacement workflow |
| missing transferable source/document | Property Task / source-admission workflow |
| conflicting decision/source | Decision review / Property Task |
| missing transfer redaction/consent | Property Task / disclosure review |

If a dedicated canonical domain exists, routing to a generic task is invalid.

## 6. Generic Property Task

Allowed only for bounded administrative/remediation work without a dedicated domain.

Examples:

- request missing document;
- re-verify metadata;
- confirm source identity;
- perform transfer redaction review;
- obtain disclosure consent.

Generic Property Task must not represent a payment, inspection, warranty defect, RFI, acceptance or change order.

## 7. Recommendation payload

Candidate fields:

- recommendation_id;
- property_id;
- trust_snapshot_id;
- policy_id;
- policy_version;
- requirement_id;
- dimension;
- reason_code;
- severity;
- blocking;
- explanation;
- subject_type / subject_id;
- responsible_role_class;
- proposed_action_type;
- linked_canonical_entity_type / id;
- due_at;
- due_source_type / source_id / version;
- closure_predicate_id / version;
- closure_evidence_policy;
- dedupe_key;
- first_detected_at;
- last_evaluated_at;
- state;
- supersedes / superseded_by.

## 8. Explanation contract

Every recommendation must answer:

1. What is wrong or missing?
2. Why does the requirement apply?
3. Why does it matter for this profile/purpose?
4. What exact source/evidence is missing, stale or conflicted?
5. Who can act?
6. What canonical action is appropriate?
7. What evidence/result will actually close the requirement?
8. Does it block transfer/verification or merely need attention?

Never say only "Improve trust score".

## 9. Responsibility

Policy may nominate candidate responsible roles.

Assignment still respects live Renova ACL/team/provider rules.

Possible roles:

- owner/controller;
- contractor;
- supervisor/inspector;
- property manager;
- service provider;
- compliance/document administrator;
- enterprise administrator.

If no eligible actor exists:

- keep recommendation unassigned;
- route to owner/manager triage;
- optionally recommend invite/assignment.

Never grant access to satisfy assignment.

## 10. Due date / SLA provenance

No arbitrary deadlines.

Allowed due sources:

- contract;
- warranty;
- manufacturer maintenance schedule;
- official recall notice;
- organisation policy;
- RFI/Submittal/inspection policy;
- service agreement;
- owner-selected target;
- jurisdiction/regulatory policy.

Every due date stores provenance.

If there is no valid source:

- no fake SLA;
- priority may still exist;
- UI says "Срок не задан".

## 11. Priority bands

Use deterministic bands:

1. safety / official recall;
2. profile-blocking critical;
3. overdue mandatory;
4. high / near due;
5. transfer or verification blocker;
6. medium attention;
7. documentation improvement.

Within a band, order by:

- due date;
- age;
- dependency/criticality;
- explicit user priority.

No hidden AI priority score may downgrade a mandatory action.

## 12. Closure predicates

Each recommendation binds to an explicit closure predicate.

Examples:

### Missing commissioning

Satisfied when:

- admitted commissioning record exists;
- source class accepted by policy;
- required fields complete;
- subject asset matches.

### Maintenance overdue

Satisfied when:

- canonical Service Case completed;
- required completion evidence admitted;
- maintenance cycle advanced.

### Stale source

Satisfied when:

- current source/status successfully admitted or verified;
- stale source superseded;
- policy freshness rule passes.

### Confirmed recall

Satisfied when:

- remediation workflow completed;
- required replacement/inspection evidence exists;
- installed asset/history updated;
- recall obligation policy passes.

### Missing inspection evidence

Satisfied when:

- required Inspection Submission reaches accepted/qualified state;
- required evidence fields pass.

### Transfer redaction/consent

Satisfied when:

- current dossier version has authorised review/consent receipt.

"Canonical action closed" is not a sufficient generic closure predicate.

## 13. Closure evaluation result

Candidate states:

- closure_passed;
- closure_failed;
- closure_pending_source;
- closure_conflicted;
- closure_not_applicable_after_re_evaluation;
- closure_invalidated_by_policy_change.

Keep reason codes.

## 14. Action bundles

One canonical action may be linked to several recommendations.

Example:

one service visit may address:

- overdue maintenance;
- stale service status;
- missing service evidence;
- transfer blocker.

Each requirement still evaluates independently after completion.

Bundle completion cannot bulk-mark all recommendations resolved.

## 15. Dependency graph

Recommendations/actions may express:

- blocked_by;
- prerequisite_for;
- unlocks.

Examples:

- identify exact installed model -> evaluate recall;
- obtain source -> source admission;
- repair -> reinspection;
- replacement -> commissioning;
- RFI answer -> change review.

Detect and block cycles.

## 16. Dedupe semantics

On recompute:

- same unresolved root cause -> keep/update existing recommendation;
- changed policy/source/root cause -> supersede where materially different;
- resolved recommendation stays historical;
- repeated recurring cycle creates a new occurrence where appropriate.

No recommendation spam from routine recomputes.

## 17. Recurring obligations

Maintenance/service cycles need explicit recurrence identity.

Example:

`asset + maintenance_rule + cycle_due_date`

Closing the 2026 service recommendation must not permanently satisfy 2027 service.

## 18. Reopen semantics

A requirement may become unsatisfied after previous resolution.

Required behavior:

- preserve old resolved recommendation;
- create new occurrence or reopen-with-lineage per policy;
- record previous closure evidence;
- explain new triggering event.

Never mutate prior history into "was never resolved".

## 19. Snooze

Allowed only if policy permits.

Fields:

- actor;
- reason;
- snooze_until;
- created_at;
- policy/version.

Snooze suppresses reminders, not the underlying requirement.

Critical actions may forbid snooze.

## 20. Dismiss

Dismissal means:

"this recommendation is intentionally not being pursued"

not:

"requirement satisfied".

Requirements:

- policy allows dismissal;
- reason required;
- actor/role allowed;
- audit event.

Critical/profile-blocking requirements may forbid dismissal.

## 21. Waiver

Waiver is a governed policy action, separate from dismissal.

Requires:

- authorised role;
- explicit waiver policy;
- reason;
- supporting source;
- effective/expiry period;
- audit;
- visible matrix state.

Waiver does not erase the original unmet requirement.

## 22. Canonical event observation

Action Engine listens to committed canonical events.

Examples:

- Inspection accepted;
- Issue/Work Order completed;
- RFI answered/accepted;
- Submittal approved;
- Service Case completed;
- Warranty Issue resolved;
- source admitted/refreshed/revoked;
- installed asset updated;
- Decision superseded;
- transfer dossier issued/revoked.

It never writes domain state directly in response to a model suggestion.

## 23. Recompute flow

Preferred:

```
canonical transaction
-> outbox/domain event
-> affected trust requirements identified
-> requirement evaluation
-> new Trust Matrix snapshot
-> recommendation reconciliation
-> UI/notification update
```

Properties:

- idempotent;
- retryable;
- policy-versioned;
- source-versioned;
- observable.

## 24. Failure isolation

If Trust Matrix recompute fails after a canonical action commits:

- canonical action remains committed;
- recommendation UI shows recompute pending/error;
- retry occurs;
- no rollback of completed business work.

## 25. Eventual consistency UX

Display separately:

- canonical action state;
- Trust Matrix snapshot timestamp;
- recompute state.

Never show trust requirement as resolved until recompute proves closure.

## 26. Recovery Plan

A Trust Recovery Plan is an ordered projection over active recommendations.

Contains:

- current posture;
- blocking actions;
- non-blocking actions;
- responsible roles;
- deadlines with provenance;
- dependencies;
- canonical action links;
- affected trust dimensions;
- expected closure requirements.

It must not promise a future score/posture.

## 27. Fast paths

### Transfer

`transfer requested -> evaluate profile -> blockers -> Recovery Plan -> execute -> recompute -> dossier issue`

### Recall

`recall admitted -> exact/candidate match -> confirmation -> action -> remediation evidence -> asset/history update -> recompute`

### Maintenance

`due -> recommendation -> Service Case -> completion -> next maintenance cycle -> recompute`

### Institutional request

`profile request -> gap evaluation -> owner remediation -> consent/redaction -> recompute -> artifact issue`

## 28. Notification policy

Notify on meaningful transitions:

- new critical/blocking recommendation;
- assignment;
- due soon;
- overdue;
- confirmed recall;
- source revoked;
- transfer flow blocked;
- canonical action completed but closure failed;
- trust blocker resolved.

Do not notify on minor percentage changes.

## 29. Escalation

Conditional on policy/contract.

May:

- notify manager;
- escalate overdue item;
- route to portfolio queue;
- propose reassignment.

Cannot:

- grant ACL;
- approve payment;
- waive requirements;
- auto-accept work.

## 30. Offline behavior

Allowed offline:

- cached recommendation read;
- evidence capture;
- draft notes;
- permitted canonical mutation intents.

Not allowed offline as final:

- trust closure;
- waiver;
- final source admission;
- final matrix recompute.

Server confirmation remains authoritative.

## 31. AI assistance boundary

Allowed:

- explain recommendation;
- summarise supporting sources;
- draft action text;
- suggest likely canonical route;
- suggest bundles;
- prepare Recovery Plan narrative.

Forbidden:

- mark resolved;
- fabricate evidence;
- change authoritative deadline source;
- waive;
- close canonical action;
- create high-risk action without user/domain approval;
- downgrade severity/blocker.

## 32. Action audit receipt

Record:

- recommendation_id;
- originating trust snapshot;
- requirement/policy;
- actor acknowledgement;
- canonical entity link;
- action creation event;
- completion event;
- closure evaluation;
- resulting trust snapshot;
- snooze/dismiss/waiver;
- supersession/reopen.

This provides traceability without copying canonical action history.

## 33. Portfolio Action Queue

Filters:

- blocking;
- critical;
- overdue;
- recall;
- maintenance;
- source freshness;
- transfer;
- unassigned;
- owner/role/provider;
- property.

No universal "portfolio action score".

## 34. Metrics

### Recommendation-to-action conversion

`linked_actionable_recommendations / actionable_recommendations`

### Acknowledgement latency

`acknowledged_at - first_detected_at`

### Remediation latency

`requirement_resolved_at - first_detected_at`

### Closure failure rate

`canonical_actions_completed_but_predicate_failed / canonical_actions_completed_for_recommendations`

### Reopen rate

Separate:

- legitimate recurring cycles;
- regression/reappearance.

### Duplicate recommendation rate

Same unresolved root cause should approach zero duplicates.

### Transfer-blocker resolution

`profile_ready_at - transfer_flow_started_at`

## 35. Data model anti-duplication tests

Required assertions:

- recommendation cannot own canonical payment/acceptance status;
- one recommendation may link to at most the valid canonical action relation(s) defined by routing policy;
- canonical action status is read-only from Action Engine perspective;
- duplicate dedupe key cannot create multiple active recommendations unless policy explicitly allows occurrences;
- resolved historical recommendation cannot be deleted by recompute.

## 36. Security / ACL

- recommendation visibility derives from property/project/domain access;
- hidden linked entity must not leak title/details through recommendation text;
- assignment cannot grant access;
- external institution profiles see only purpose-scoped recommendations if policy permits;
- owner private recommendations are not automatically transferable.

## 37. Manual review / override

Any manual action-engine correction records:

- actor;
- reason;
- before/after;
- source;
- timestamp;
- policy/version.

No silent admin edit.

## 38. Example

Trust Matrix finds:

- maintenance obligation overdue;
- requirement blocking property_transfer profile;
- source: boiler manufacturer maintenance schedule;
- owner has an eligible service provider.

Action Engine produces:

```
Reason:
Annual boiler service is overdue.

Why it matters:
Current transfer policy requires current maintenance state for this installed system.

Canonical action:
Create Service Case.

Responsible:
Current owner / authorised service provider.

Due source:
Manufacturer maintenance interval.

Closure:
Service Case completed + required service evidence admitted + maintenance cycle advanced.

Affected dimensions:
Maintenance Continuity
Transfer Readiness
Source Freshness (if service status is refreshed)
```

After Service Case completion:

- Action Engine does not immediately mark resolved;
- recompute evaluates evidence;
- if evidence missing -> closure_failed;
- recommendation remains actionable;
- if predicate passes -> new Trust Matrix snapshot;
- recommendation becomes resolved_from_domain.

## 39. Definition of Done

Implementation is not complete until:

- mapping registry is versioned;
- recommendation dedupe is deterministic;
- no parallel task authority exists;
- deadline provenance exists;
- closure predicates are explicit/tested;
- canonical events trigger idempotent recompute;
- closure failure path exists;
- recurring obligations reopen correctly;
- snooze/dismiss/waiver are distinct;
- offline cannot falsely resolve;
- AI cannot satisfy requirements;
- every resolved recommendation traces to canonical action + evidence + resulting Trust Matrix snapshot.
