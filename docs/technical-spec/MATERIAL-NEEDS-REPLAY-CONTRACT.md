# RENOVA material-needs replay contract

Status: P0 recovery contract for #419, child of #316. This change is stacked on #322 and must be requalified after the owner merges that base.

## Business intent

`POST /projects/{project_id}/material-needs/from-estimate` means: synchronize currently missing material needs from the estimate once for one client intent.

The identity of one intent is `client_request_id`, minted before the first network attempt and preserved byte-for-byte through the offline queue and restart replay. Two deliberate invocations with identical visible inputs are two separate intents and therefore must receive different request IDs.

## Transaction boundary

The authoritative write order is:

```text
project row lock
-> fresh project-write authority
-> ClientWriteRequest replay lookup
-> prepare/flush missing MaterialPick rows
-> persist result snapshot in activity outbox when rows were created
-> persist ClientWriteRequest mapping
-> one database commit
-> best-effort outbox dispatch
```

Material truth, replay ledger and required activity evidence must never be committed in separate transactions. A failure after `MaterialPick` flush but before durable outbox/ledger completion must roll back the picks, outbox and request identity together; retrying the same request ID after that rollback must create one clean canonical result.

## Replay semantics

- same user/project/request ID returns the original created-item snapshot even if the estimate changed after the first commit;
- a successful zero-result intent is durable and replays as zero rather than re-entering generation;
- a different request ID is a new intent and may synchronize newly-added estimate material lines;
- response loss after commit must not create a second material need or a second activity result snapshot;
- replay corruption (ledger points at a missing/invalid non-zero snapshot) fails closed.

## Concurrency and authorization

The project row is locked before replay lookup and candidate material creation. This serializes concurrent generation for one project, including different intent IDs.

The physical PostgreSQL same-key proof must demonstrate that two independent database sessions both reached the production serialization boundary before either is released to acquire the project row lock. Merely starting two coroutines with `gather()` is not sufficient race evidence.

Because lock acquisition can wait, current write authority is re-read after the lock is acquired. The revocation proof must demonstrate that the creator reached the production lock call, remained physically blocked behind a separately held PostgreSQL row lock, and then received 403 after contractor assignment was revoked. The forbidden attempt must persist no `MaterialPick`, `ClientWriteRequest` or material-needs outbox effect.

Historical duplicate MaterialPick rows do not crash generation: existence checks are fail-safe and only need to establish whether at least one matching project/name/room row already exists.

## Mobile retry policy

After server replay safety exists, mobile may durably queue the exact serialized request for:

- normalized transport/status `0` failures;
- a successful HTTP response whose body cannot be parsed and therefore leaves commit outcome ambiguous;
- HTTP 429;
- HTTP 5xx.

Other deterministic HTTP 4xx responses are authoritative and must not be converted into queued success. Failure to persist the queue must remain an error, never a claimed offline success.

## Required qualification

Before this slice is called qualified on an exact head:

- `backend/tests/test_material_needs_replay.py` is an explicit mandatory behavioral-gate input;
- JUnit must require both exact semantic cases by testcase name: original-snapshot/changed-estimate/zero-result replay and negative atomic rollback/retry after outbox-preparation failure;
- `backend/tests/test_material_needs_replay_postgres.py` is an explicit migrated-PostgreSQL gate input;
- JUnit must require both exact PostgreSQL cases by testcase name: physical same-key serialization and revoke-while-waiting authority recheck;
- neither required gate may contain a skipped, failed or errored testcase and aggregate green counts/source-file presence are not substitutes for the named scenarios;
- the PostgreSQL same-key scenario proves one `MaterialPick`, one `ClientWriteRequest` and one activity snapshot tied to the canonical ledger entity ID;
- the mobile CI job invokes `scripts/materialNeedsTransport.test.mjs` directly rather than through another harness;
- the actual mobile transport/restart harness proves exact-body lost-response replay, normalized status-0 queueing, corrupt-2xx ambiguity, 429/5xx queueing, authoritative deterministic 4xx, persistence failure, restart/flush, and different request IDs for two deliberate equal-visible invocations;
- full backend, mobile, Playwright and Alembic gates remain green on the same exact candidate/qualification context.

The material-supply PostgreSQL workflow retains JUnit artifacts so the named scenarios can be inspected after the run.

This contract does not close parent #316, #317, G04/G05 or GP1-GP8.
