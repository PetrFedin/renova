# Floor-plan create and room-pin recovery contract

Status: normative bounded recovery contract for issue #475 / parent #316.

This annex governs only the canonical floor-plan create and room-pin upsert business POSTs. It does not claim canonical-main integration, Golden Path completion, or completion of #316.

## 1. Classification boundary

The `floor` family is intentionally split by mutation semantics:

- `createFloorPlan` — replay-sensitive entity create with durable activity evidence: covered here.
- `pinFloorPlanRoom` — replay-sensitive business upsert with durable activity evidence and a second canonical acceptance writer: covered here.
- `createFurniture` — covered by #468/#469.
- waste-order create/transitions — covered by #470/#471.
- `moveFloorPin` and `moveFurniture` — naturally idempotent coordinate setters for identical request bytes and have no durable activity/outbox side effect. Their current status-0/offline transport-normalization gap belongs to #317 and is explicitly not changed by #475.

A POST is not considered unsafe merely because it is a POST; the contract follows actual entity/effect semantics.

## 2. Floor-plan create chain

Canonical chain:

`FloorPlanPanel.uploadPlan → media upload → floorApi.createFloorPlan → stable client_request_id before first transport attempt → one serialized request body → req → ambiguous-response handling → durable offlineQueue → restart/flush → POST /projects/{project_id}/floor-plans → Project row lock → fresh project-write authority → ClientWriteRequest replay lookup → FloorPlan flush → activity DomainOutbox → ClientWriteRequest → one commit → best-effort inline dispatch`.

Required semantics:

1. `client_request_id` exists before the first network attempt and is included in the first serialized body.
2. Durable retry stores and replays those exact serialized bytes; restart does not mint a replacement ID.
3. Deterministic 4xx except 429 are authoritative. Transport/status-0, 429, 5xx and unreadable/corrupt 2xx responses are ambiguous and may queue only because the server operation is replay safe.
4. Queue persistence failure is fail closed.
5. Same request ID + same canonical plan payload returns the original FloorPlan with `replayed=true` and creates no second activity.
6. Same request ID + changed canonical payload fails with HTTP 409 `idempotency_conflict`.
7. Distinct request IDs remain distinct deliberate floor-plan creates even when visible values are equal.
8. Project write authority is re-evaluated after any Project-row-lock wait. Revocation while waiting fails closed.
9. FloorPlan, its `kind="plan"` activity outbox row and ClientWriteRequest are one transaction. Failure after FloorPlan flush rolls all three back.
10. Postcommit activity delivery is acceleration only; delivery failure must not turn a committed create into an apparent create failure.
11. `FloorPlanPanel` treats `offline_queued` as deferred synchronization: it shows the offline notification and does not show the generic upload-failure/retry alert or run postcommit side-effect sync before the queued create is actually committed.

## 3. Room-pin upsert chain

Canonical client chain:

`floorApi.pinFloorPlanRoom → stable client_request_id + exact serialized body → req/queue/restart → POST /projects/{project_id}/floor-plans/{plan_id}/pins → Project row lock → fresh project-write authority → FloorPlan row lock → ClientWriteRequest replay lookup → project-bound Room validation → read/update-or-insert FloorPlanPin → activity DomainOutbox → ClientWriteRequest → one commit → best-effort inline dispatch`.

Acceptance chain:

`finalize_work_acceptance → mark_acceptance_pin_on_plan → latest FloorPlan FOR UPDATE → update-or-insert acceptance label → surrounding acceptance transaction`.

Required semantics:

1. Client pin intent identity follows the same first-send/exact-replay/4xx/429/5xx/corrupt-2xx/storage-failure rules as floor-plan create.
2. `plan_id` is part of the canonical request payload for conflict detection even though it is URL-bound.
3. URL project owns both plan and room. Existing #441 object-binding protection remains mandatory.
4. Same request ID + same canonical pin payload returns the already committed pin and does not emit a second `room_change` activity.
5. Same request ID + changed payload fails 409.
6. A distinct request ID represents a distinct user intent; for the same `(plan, room)` it updates the one canonical pin and may emit one new activity for that deliberate intent. It never creates a second pin row.
7. API pin writer and acceptance pin writer serialize on the same `FloorPlan FOR UPDATE` boundary. No new broad unique/dedup migration is introduced by this bounded slice.
8. Acceptance keeps its existing outer transaction and gains no ClientWriteRequest or independent commit.
9. API pin state, activity outbox and ClientWriteRequest are one transaction; failure after pin flush rolls all of them back.
10. Replay lookup occurs before mutable Room revalidation for an already committed intent. A successful historical intent is not re-decided merely because a mutable reference changed after commit.

## 4. Mandatory qualification evidence

The bounded candidate is not `CANDIDATE PROVEN` unless all items below execute on one exact candidate context.

### Production mobile transport

`node scripts/floorPlanTransport.test.mjs` must execute the actual mobile API/client/AsyncStorage queue path for both `createFloorPlan` and `pinFloorPlanRoom` and prove, for each writer:

- lost-response restart replay is byte-identical;
- deterministic 400/401/403/404/409/422 do not queue;
- 429 and 5xx queue the original intent;
- transport/status-0 failure queues the original intent;
- corrupt 2xx is ambiguous and queues the original intent;
- storage failure does not claim queue success;
- normal success does not queue;
- two equal-visible deliberate calls mint different request IDs.

The harness must report 16 scenarios per writer / 32 total.

### Real queued-upload UI behavior

`node scripts/floorPlanQueuedUi.test.mjs` must transpile and execute the real `FloorPlanPanel` upload action with platform mocks. For an actual `offline_queued` result it must prove:

- floor-plan create is invoked exactly once;
- the deferred-sync notification is shown;
- the generic upload-failure Alert is not shown;
- application error reporting is not invoked for the expected queued condition;
- postcommit side-effect sync is not run before the queued mutation is committed.

### Behavioral backend

JUnit must execute without skip/failure/error the exact cases for:

- plan replay/conflict/distinct intent + one activity per deliberate intent;
- plan post-flush rollback and same-intent recovery;
- pin replay/conflict/foreign-room protection + one activity per deliberate intent;
- pin post-flush rollback and same-intent recovery;
- inherited floor object-binding protection.

### Migrated PostgreSQL

On an Alembic-upgraded PostgreSQL database, JUnit must execute without skip/failure/error exact cases for:

- same-key floor-plan create race reaching the production Project-lock boundary and producing one plan/effect/ledger;
- floor-plan create authority revocation while physically waiting on the Project lock;
- two distinct API pin intents racing for one plan/room and leaving one pin;
- API pin and acceptance pin physically waiting on the same held FloorPlan row and leaving one canonical pin.

Concurrency proof must show actual lock waiting, not merely `asyncio.gather()`.

### Regression

The same exact candidate must also pass:

- the full backend suite and PostgreSQL Alembic upgrade;
- mobile typecheck/contracts;
- Playwright API/browser suite;
- inherited #441 floor binding, #469 furniture recovery and #471 waste recovery mandatory gates on the combined stack;
- repository governance policy with a non-decreasing comparable test baseline.

Unrelated inherited dependency/image failures remain attributed to #372/#389 and are not floor-plan evidence.

## 5. Status boundary

Passing this annex proves only the bounded floor-plan create and pin-upsert recovery primitive on the tested exact candidate. It does not make the change `PROVEN` on canonical `main`, does not close #316 until the remaining mutation inventory is repeated, and does not authorize starting #315/#317 before the ordered Completion Board permits it.
