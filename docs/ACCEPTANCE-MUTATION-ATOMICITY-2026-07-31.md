# Acceptance mutation atomicity — 2026-07-31

## Confirmed defects

The app and portal return flows committed `WorkAcceptance`, `Stage` and optional `ProjectIssue` first, then created activity and notifications through separate commit-producing services. A failure after the first commit could therefore leave a returned stage without part of its audit and notification evidence.

The app request flow had the same boundary: the acceptance and review-state stage were committed before activity and notifications. Portal and app return logic were also duplicated, so fixes could diverge.

## Canonical transition contract

`acceptance_mutation_service.py` now owns request and return transitions.

### Request

- lock the project stage;
- return an existing active request without creating another transition;
- create the acceptance and move the stage to review;
- create deterministic activity/notification outbox leaf events;
- commit state and durable effects together.

### Return

- verify project ownership of the acceptance and stage;
- claim the pending acceptance through one conditional `UPDATE ... WHERE status IN (requested, in_review) RETURNING`;
- only one caller can move it to returned;
- restore the stage to active/rework state;
- optionally create one project issue;
- create deterministic activity/notification outbox leaf events;
- commit all rows together.

An outbox write failure rolls the acceptance, stage and issue back. A successful transition followed by client retry is rejected as already decided and cannot create duplicate effects.

## Runtime route consolidation

Three legacy mutation routes are removed from the runtime registry by exact path and method:

- app request acceptance;
- app return acceptance;
- portal return acceptance.

The canonical routes are registered once. Read/list routes and the existing portal accept route remain intact. Legacy source definitions remain temporarily for safe decomposition but cannot execute at runtime.

## Tests

`test_acceptance_mutation_atomicity.py` verifies:

- request state and deterministic outbox rows commit together;
- leaf dispatch creates one activity and one notification;
- return is single-winner and replay-safe;
- an outbox failure rolls back return state, rework issue and new effects;
- runtime contains exactly one route for each mutation while preserving list and portal accept routes;
- canonical route modules contain no direct commit and route through the atomic service.

## Residual risks

- PostgreSQL row locking protects concurrent request creation, but there is no database partial unique index for one active acceptance per stage. A dedicated constraint can be added if cross-version PostgreSQL migration compatibility is confirmed.
- Legacy mutation function definitions remain in `work_acceptances.py` and `portal.py`, although excluded from runtime. Physical deletion belongs to the decomposition wave.
- Portal accept already uses a durable parent outbox event; request/return use deterministic leaf events directly. This is intentional because each transition has a small fixed effect set.
