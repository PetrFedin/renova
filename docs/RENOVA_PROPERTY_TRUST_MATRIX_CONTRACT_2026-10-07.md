# Renova — Property Trust Matrix Contract

**Date:** 2026-10-07  
**Status:** RESEARCH / CALCULATION & POLICY CONTRACT  
**Implementation gate:** after #683 admission and #668 Verified Execution Record requalification.

## 1. Purpose

Define an explainable, reproducible property-trust matrix.

This contract explicitly rejects a default opaque universal property score.

The product answers:

- what is known;
- how well it is evidenced;
- what is stale;
- what remains unresolved;
- whether a declared disclosure/transfer profile is ready;
- which primary sources support each conclusion.

## 2. Core dimensions

Required initial matrix:

1. history_coverage;
2. evidence_completeness;
3. maintenance_continuity;
4. source_freshness;
5. unresolved_risk_obligations;
6. transfer_readiness.

Optional supporting dimensions:

7. provenance_strength;
8. verification_portability.

## 3. Requirement policy

Each dimension is computed from a versioned requirement policy.

Illustrative structure:

```json
{
  "policy_id": "property_transfer_ru_v1",
  "version": "1.0",
  "purpose": "property_transfer",
  "jurisdiction": "RU",
  "effective_from": "2026-10-07",
  "minimum_coverage": 0.8,
  "requirements": [
    {
      "requirement_id": "installed_assets_major_systems",
      "dimension": "history_coverage",
      "applicability": "has_major_installed_systems",
      "weight": 2,
      "blocking": false,
      "accepted_source_classes": ["renova_accepted","external_official","qualified_third_party"]
    }
  ]
}
```

This is an illustrative schema, not a final API.

## 4. Requirement result states

Allowed states:

- satisfied;
- partially_satisfied;
- missing;
- stale;
- conflicted;
- blocked;
- not_applicable;
- unknown.

Every result records:

- requirement_id;
- state;
- applicable;
- weight;
- satisfaction_factor if partial is permitted;
- source refs;
- reason code;
- evaluated_at;
- evaluator/policy version.

## 5. Coverage

Formula:

`coverage = evaluated_applicable_weight / applicable_weight`

Where:

- not_applicable is excluded;
- unknown applicable requirements remain in applicable weight but not evaluated weight;
- policy defines the minimum coverage required before a percentage may be displayed.

If:

`coverage < minimum_coverage`

the UI shows:

`INSUFFICIENT_DATA`

rather than a misleading percent.

## 6. Percentage dimensions

Generic formula:

`dimension_percent = satisfied_weight / applicable_weight * 100`

With:

`satisfied_weight = Σ(weight * factor)`

Possible factors:

- satisfied = 1.0;
- partially_satisfied = explicit policy factor;
- missing/stale/conflicted/blocked = 0 unless a policy defines another visible treatment;
- not_applicable excluded.

Do not silently assign partial factors in code outside policy.

## 7. History Coverage

Question:

"Are the relevant lifecycle episodes/facts documented?"

Candidate requirement families:

- renovation episodes;
- major works;
- major decisions;
- major systems/assets;
- commissioning;
- restoration;
- major service/replacement;
- ownership/control transfer.

Formula:

`history_coverage_percent = documented_history_weight / applicable_history_weight * 100`

"Never happened" and "history unknown" are distinct states.

## 8. Evidence Completeness

Question:

"Do documented facts have the evidence required for this purpose?"

Formula:

`evidence_completeness_percent = satisfied_required_evidence_weight / applicable_required_evidence_weight * 100`

Optional media does not increase the numerator.

Duplicate files do not create multiple satisfaction credit unless requirements are genuinely independent.

## 9. Maintenance Continuity

Question:

"Are known maintainable assets current with their sourced obligations?"

Eligible states:

- not_due;
- completed_on_time;
- completed_late;
- due;
- overdue;
- schedule_unknown;
- source_unavailable;
- not_applicable.

Illustrative formula:

`maintenance_continuity_percent = current_obligation_weight / applicable_known_obligation_weight * 100`

Current means:

- not_due;
- completed within the applicable current cycle.

Late completion may still close an old obligation while creating a measurable lateness metric.

No applicable maintainable assets => N/A, not 100%.

## 10. Source Freshness

Question:

"Are time-sensitive facts current enough for the declared purpose?"

Only time-sensitive requirements participate.

Formula:

`freshness_percent = current_time_sensitive_weight / applicable_time_sensitive_weight * 100`

Possible source freshness reasons:

- valid_until;
- next_review_at;
- last_verified_at + policy interval;
- external status check;
- explicit source revocation/withdrawal.

Historical immutable events are excluded unless their current status is itself time-sensitive.

## 11. Unresolved Risk & Obligations

This dimension is status-based.

Inputs may include:

- critical open defect;
- mandatory incomplete inspection;
- active confirmed recall;
- overdue mandatory maintenance;
- unresolved high-severity warranty/service issue;
- conflicting current decisions;
- missing mandatory transfer disclosure;
- blocked verification artifact;
- other policy-defined critical obligations.

Deterministic severity:

```
if any profile_blocking_critical -> BLOCKED
else if any high_or_overdue_mandatory -> ACTION_REQUIRED
else if any medium_attention -> ATTENTION
else -> CLEAR_FOR_DECLARED_SCOPE
```

Counts, age and source are shown.

There is no "risk score 83".

## 12. Transfer Readiness

Question:

"Can the declared transfer profile be safely and truthfully issued?"

Formula:

`transfer_readiness_percent = satisfied_mandatory_transfer_weight / applicable_mandatory_transfer_weight * 100`

But:

- any blocking mandatory requirement => NOT_READY;
- insufficient coverage => INSUFFICIENT_DATA;
- 100% does not imply legal title quality or physical safety.

## 13. Provenance Strength

Show distribution by source class.

Example output:

```json
{
  "renova_accepted": 0.42,
  "external_official": 0.18,
  "qualified_third_party": 0.12,
  "manufacturer_declared": 0.10,
  "contractor_declared": 0.08,
  "owner_provided": 0.07,
  "derived": 0.03
}
```

Optional summary:

`stronger_source_coverage = accepted_strong_source_weight / satisfied_applicable_weight`

Policy defines what counts as a stronger source for that requirement/profile.

## 14. Verification Portability

Status examples:

- not_configured;
- artifact_issued;
- signature_valid;
- current;
- superseded;
- revoked;
- status_unavailable.

Do not convert this into a percent unless a future policy has multiple explicit verifiable requirements.

## 15. Overall Trust Posture

Allowed initial states:

- INSUFFICIENT_DATA;
- INCOMPLETE;
- ACTION_REQUIRED;
- TRANSFER_READY_FOR_DECLARED_PROFILE;
- VERIFIED_FOR_DECLARED_PROFILE.

Example deterministic policy:

```
if mandatory_coverage < policy.minimum_coverage:
    INSUFFICIENT_DATA
elif blocking_risk_exists:
    ACTION_REQUIRED
elif mandatory_requirements_missing:
    INCOMPLETE
elif portable_verification_required and portable_verification_current:
    VERIFIED_FOR_DECLARED_PROFILE
else:
    TRANSFER_READY_FOR_DECLARED_PROFILE
```

No weighted average.

## 16. Snapshot schema

Illustrative:

```json
{
  "snapshot_id": "opaque-id",
  "property_id": "opaque-id",
  "purpose": "property_transfer",
  "policy_id": "property_transfer_ru_v1",
  "policy_version": "1.0",
  "source_cutoff": "RFC3339",
  "computed_at": "RFC3339",
  "posture": "ACTION_REQUIRED",
  "dimensions": {},
  "blockers": [],
  "requirements": [],
  "source_manifest_digest": "digest",
  "supersedes": "previous-snapshot-id"
}
```

## 17. Reproducibility

A historical snapshot must be reproducible from:

- policy/version;
- source manifest;
- source versions;
- deterministic calculation code version;
- source cutoff.

If source data is later deleted under lawful policy, retained snapshot reproducibility follows the applicable retention/legal-hold rules.

## 18. Recompute model

Do not recompute synchronously on every screen render.

Preferred:

`domain event/outbox -> affected requirement invalidation -> async recompute -> snapshot -> UI refresh`

Trigger examples:

- accepted/reworked work;
- installation/commissioning;
- service/maintenance;
- decision supersession;
- recall update;
- source admission/revocation;
- ownership transfer;
- transfer dossier issue;
- policy update.

## 19. Explainability payload

Every dimension exposes:

- value/status;
- coverage;
- numerator;
- denominator;
- policy/version;
- blocker count;
- stale count;
- conflicted count;
- top reasons;
- requirement drill-down.

Every requirement exposes:

- why applicable;
- state;
- accepted requirement;
- current source;
- missing source if any;
- next action.

## 20. Reason-code taxonomy

Initial candidates:

- source_missing;
- source_stale;
- source_revoked;
- source_conflict;
- evidence_missing;
- evidence_wrong_scope;
- evidence_superseded;
- maintenance_overdue;
- maintenance_schedule_unknown;
- recall_confirmed_open;
- recall_candidate_unresolved;
- transfer_consent_missing;
- transfer_redaction_review_missing;
- verification_artifact_missing;
- verification_revoked;
- insufficient_history;
- requirement_not_applicable.

UI text localises reason codes; analytics stores stable codes.

## 21. Source conflict

Conflict is not resolved by source recency alone.

Policy may define:

- authoritative source precedence;
- manual review;
- effective-date rule;
- supersession lineage.

Until resolved, requirement remains conflicted and is excluded from verified coverage.

## 22. Anti-gaming

Reject:

- duplicate upload credit;
- irrelevant optional document credit;
- evidence from another project/property;
- stale re-upload presented as fresh;
- self-declaration replacing mandatory inspection;
- revoked/superseded source counted current;
- manual override without reason/source/audit;
- source splitting to multiply weight.

## 23. Manual override

If a policy permits override:

- privileged actor only;
- explicit reason;
- source/supporting evidence;
- expiry/review date where applicable;
- audit event;
- visible override marker;
- does not rewrite original requirement result.

## 24. Role-specific projections

Same snapshot, different projection.

### Owner

Show:

- posture;
- six dimensions;
- blockers;
- improvement actions.

### Buyer

Show:

- transfer readiness;
- history/evidence;
- open known issues;
- provenance;
- verification status.

### Property manager

Show:

- maintenance;
- stale sources;
- recalls;
- emergency-info freshness;
- unresolved obligations.

### Insurer

Show:

- pre-loss coverage;
- installed product/asset provenance;
- maintenance;
- restoration/claim evidence.

### Lender/valuer

Show:

- renovation history;
- evidence/provenance;
- major systems;
- official reference documents;
- coverage.

## 25. Portfolio view

Do not rank properties by one composite.

Portfolio columns:

- posture;
- coverage;
- history coverage;
- evidence completeness;
- maintenance status;
- stale source count;
- critical/open obligations;
- transfer readiness.

Primary sort/filter use case:

"What needs attention?"

## 26. UI recommendation

Preferred:

- posture banner;
- horizontal dimension rows/bars;
- status icon/text;
- explicit coverage;
- top blocker;
- drill-down.

Avoid:

- single circular gauge;
- star rating;
- letter grade;
- spider/radar chart as sole representation.

## 27. Institutional export

External profile may include:

- posture for the declared profile;
- dimension results;
- coverage;
- blocker summary;
- policy/version;
- source manifest;
- verification artifact/status.

Do not export a generic "Renova Trust Score".

## 28. Metrics

Operational product metrics:

- sufficient-coverage property rate;
- median blockers/property;
- median blocker resolution time;
- stale-source resolution time;
- transfer-ready preparation time;
- provenance-strength distribution;
- percentage of matrix views that drill to source;
- institutional verification success rate.

## 29. Testing

Required unit/property tests:

- N/A excluded from denominator;
- unknown suppresses misleading percent under coverage threshold;
- blocker cannot be averaged away;
- stale historical fact not penalised if not time-sensitive;
- source conflict reduces verified coverage;
- revoked source does not count current;
- duplicate evidence does not multiply credit;
- policy-version change produces new snapshot;
- old snapshot remains reproducible;
- wrong-project evidence never satisfies requirement.

## 30. Example

Suppose transfer policy has:

- 10 applicable history requirements; 8 documented;
- 20 required evidence items; 18 satisfied;
- 4 known maintenance obligations; 3 current, 1 overdue;
- 5 time-sensitive sources; 4 current, 1 stale;
- one overdue mandatory maintenance item;
- 12 mandatory transfer requirements; 11 satisfied.

Then:

- History Coverage = 8 / 10 = **80%**
- Evidence Completeness = 18 / 20 = **90%**
- Maintenance Continuity = 3 / 4 = **75%**
- Source Freshness = 4 / 5 = **80%**
- Unresolved Risk & Obligations = **ACTION_REQUIRED**
- Transfer Readiness = 11 / 12 = **91.7%**, but **NOT_READY** because a mandatory blocker exists

Overall posture:

**ACTION_REQUIRED**

Not:

**84.3 / 100**

This is the core anti-magic-score rule.

## 31. Definition of Done

Implementation is not complete until:

- policy is versioned;
- formulas are deterministic;
- all denominators are inspectable;
- coverage gate exists;
- blockers override aggregate percentages;
- source provenance/freshness remain separate;
- every result drills to source;
- snapshot is reproducible;
- profile-specific views exist;
- no external API exposes a universal opaque score.
