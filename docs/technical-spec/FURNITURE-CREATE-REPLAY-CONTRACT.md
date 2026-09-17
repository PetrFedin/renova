# RENOVA furniture create replay contract

Status: P0 recovery contract for #468, child of #316 and stacked on the #377/#441 floor-object binding candidate. This slice must be refreshed/requalified after its upstream security/recovery bases are owner-merged.

## Business intent

`POST /projects/{project_id}/furniture` creates one furniture item for one logical client intent.

`client_request_id` is minted before the first network attempt. The exact serialized request body, including all furniture dimensions, coordinates, optional room/floor-plan references and the request ID, must survive offline queue persistence and application restart. Two separate user invocations with identical visible furniture values are separate intents and must receive different request IDs.

The UI must never construct a second fallback payload. `floorApi.createFurniture()` is the sole owner of transport/retry admission for this product action.

## Canonical payload

The idempotency payload excludes only `client_request_id` and includes the persisted furniture fields with their server defaults:

`room_id, floor_plan_id, name, width_m, depth_m, height_m, x_pct, y_pct, notes`.

Same request ID + same canonical payload returns the original FurnitureItem. Same request ID + changed canonical payload fails with `409 idempotency_conflict`. Payload equality without the same request ID is never business dedupe.

## Transaction and authorization boundary

The authoritative write order is:

```text
project row lock
→ fresh project-write authority
→ ClientWriteRequest replay lookup
→ validate optional room/floor-plan references against the URL project
→ prepare FurnitureItem
→ SQL flush
→ prepare durable activity outbox
→ persist ClientWriteRequest mapping
→ one database commit
→ best-effort outbox dispatch
```

Furniture state, durable activity evidence and request ledger must not commit in separate transactions. Because Project-row-lock acquisition can wait, project-write authority is re-read after the lock is acquired.

The #377/#441 security invariant is retained: `room_id` and `floor_plan_id`, when present, must belong to the URL project. Recovery safety must not re-open cross-project object binding.

## Replay and rollback semantics

- response loss after commit replays to the original FurnitureItem and must not create another item or activity effect;
- a different request ID with identical furniture values creates a distinct deliberate item;
- failure after the FurnitureItem has been SQL-flushed but before outbox/ledger commit must roll back item, outbox and request ledger together;
- retrying that exact same request ID after the transient failure must complete once;
- physical same-key PostgreSQL concurrency must prove two independent sessions reach the production Project-row-lock boundary before release and converge on one canonical item/effect set;
- if contractor access is revoked while an importer is physically waiting behind a separately held Project row lock, the write must fail 403 with zero furniture/request-ledger/outbox delta.

## Mobile retry policy

After server replay safety exists, mobile may durably queue the exact serialized request for:

- normalized transport/status `0` failures;
- ambiguous successful transport with an unreadable 2xx body;
- HTTP 429;
- HTTP 5xx.

Other deterministic HTTP 4xx responses are authoritative and must not queue. Failure to persist AsyncStorage queue state remains an error and must never be reported as `offline_queued`.

## Required qualification

Before this slice is called qualified on an exact head:

- ordinary backend tests must execute exact replay/conflict/distinct-intent and post-flush rollback/retry scenarios;
- migrated PostgreSQL must explicitly execute same-key physical serialization and revoke-while-waiting scenarios;
- JUnit must require those exact testcase names and reject missing/skipped/failing/erroring cases;
- production mobile transport/restart harness must invoke `floorApi.createFurniture()` directly and prove exact-body persistence, response-loss/restart replay, corrupt-2xx ambiguity, deterministic 4xx no-queue, 429/5xx/status-0 queue, storage failure fail-closed and distinct IDs for distinct equal-visible intents;
- source proof must fail if `FurnitureLayer` reintroduces generic `enqueueOfflineCreate()` fallback;
- #441 object-binding regressions and Playwright positive/foreign-reference paths must remain green;
- full backend/mobile/Playwright/Alembic gates must remain green.

This contract does not close parent #316, floor-plan/pin recovery, #315/#317, #441 PostgreSQL qualification, or any Golden Path.