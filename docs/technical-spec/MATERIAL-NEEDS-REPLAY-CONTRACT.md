# RENOVA material-needs replay contract

Status: P0 recovery contract for #419, child of #316. This change is stacked on #322 and must be requalified after the owner merges that base.

## Business intent

`POST /projects/{project_id}/material-needs/from-estimate` means: synchronize currently missing material needs from the estimate once for one client intent.

The identity of one intent is `client_request_id`, minted before the first network attempt and preserved byte-for-byte through the offline queue and restart replay.

## Transaction boundary

The authoritative write order is:

```text
project row lock
-> fresh project-write authority
-> ClientWriteRequest replay lookup
-> prepare missing MaterialPick rows
-> persist result snapshot in activity outbox when rows were created
-> persist ClientWriteRequest mapping
-> one database commit
-> best-effort outbox dispatch
```

Material truth, replay ledger and required activity evidence must never be committed in separate transactions.

## Replay semantics

- same user/project/request ID returns the original created-item snapshot even if the estimate changed after the first commit;
- a successful zero-result intent is durable and replays as zero rather than re-entering generation;
- a different request ID is a new intent and may synchronize newly-added estimate material lines;
- response loss after commit must not create a second material need or a second activity result snapshot;
- replay corruption (ledger points at a missing/invalid non-zero snapshot) fails closed.

## Concurrency and authorization

The project row is locked before replay lookup and candidate material creation. This serializes concurrent generation for one project, including different intent IDs.

Because lock acquisition can wait, current write authority is re-read after the lock is acquired. An assigned contractor whose access is revoked while waiting must receive 403 and must persist no MaterialPick, ClientWriteRequest or outbox row.

Historical duplicate MaterialPick rows do not crash generation: existence checks are fail-safe and only need to establish whether at least one matching project/name/room row already exists.

## Mobile retry policy

After server replay safety exists, mobile may durably queue the exact serialized request for:

- normalized transport/status `0` failures;
- HTTP 429;
- HTTP 5xx.

Other deterministic HTTP 4xx responses are authoritative and must not be converted into queued success. Failure to persist the queue must remain an error, never a claimed offline success.

## Required qualification

Before this slice is called qualified on an exact head:

- SQLite semantics prove original-snapshot replay, changed-estimate behavior, independent intent IDs and durable zero-result replay;
- migrated PostgreSQL proves same-key concurrent requests produce one material result/effect set;
- migrated PostgreSQL proves revoke-while-waiting is revalidated after the project lock;
- actual mobile transport/restart harness proves lost-response replay preserves the exact body and stable request ID, 429/5xx/status0 queue, deterministic 4xx do not queue, and storage failure fails closed;
- full backend, mobile, Playwright and Alembic gates remain green.

This contract does not close parent #316, #317, G04/G05 or GP1-GP8.
