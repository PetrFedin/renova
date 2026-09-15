# RENOVA calendar import replay contract

Status: P0 recovery contract for #422, child of #316. This slice is stacked on #419 and transitively on #322. It must be requalified after its upstream recovery/security bases are owner-merged.

## Business intent

`POST /projects/{project_id}/calendar/import` imports one iCalendar payload as one logical client intent.

`client_request_id` is minted before the first send. The same serialized request body, including the original ICS content and request ID, must survive offline queue persistence and application restart.

## Canonical payload

For idempotency hashing, line endings are normalized (`CRLF`/`CR` -> `LF`) and outer whitespace is removed. This treats the same ICS payload with platform line-ending differences as the same intent while changed calendar content under the same request ID conflicts.

## Transaction and locking boundary

The authoritative order is:

```text
project row lock
-> fresh project-write authority
-> ClientWriteRequest replay lookup
-> parse canonical ICS payload
-> SELECT only stages belonging to the URL project FOR UPDATE
-> compute complete event-to-stage mapping from the immutable pre-mutation snapshot
-> apply all mapped dates and external ical_uid values in memory
-> persist ClientWriteRequest result ledger
-> one database commit
```

No per-stage commit is allowed inside import.

## Mapping semantics

For each parsed event, matching preserves the legacy priority:

1. current `ical_uid` or a UID suffix matching the stage ID;
2. case-insensitive title/name containment;
3. first originally-unscheduled stage by canonical stage order.

Fallback allocation is resolved against the original snapshot plus stages already consumed earlier in the same import. Explicit UID/title matches may still target a previously matched stage, preserving the legacy last-explicit-event-wins behavior without allowing replay to drift to another fallback stage.

All selected Stage rows come from a `Stage.project_id == URL project_id` query before mutation. A foreign stage ID is never an input to the import write path.

## Replay semantics

- same user/project/request ID + same canonical ICS payload returns the original `{parsed, updated_stages}` result without reapplying mapping;
- same request ID + changed canonical content raises `idempotency_conflict`;
- response loss after commit cannot move an unmatched event from the first empty stage to the next empty stage;
- concurrent same-key imports serialize on the project lock and produce one ledger entry and one canonical stage mapping;
- a synthetic failure before ledger commit rolls back every staged date/UID change and leaves no ledger row.

The compact replay result is encoded in `ClientWriteRequest.entity_id`; no new schema or response-snapshot table is required.

## Authorization after lock wait

Because project-lock acquisition can block, write authority is re-read after the lock is acquired. If an assigned contractor is revoked while waiting, the import fails with 403 and persists no Stage mutation or replay ledger.

## Mobile retry policy

After server replay safety exists, mobile queues the exact serialized request for:

- normalized transport/status `0` failures;
- HTTP 429;
- HTTP 5xx.

Other deterministic HTTP 4xx responses are authoritative and must not be converted into queued success. Failure to persist the queue remains an error.

## Required qualification

Before this slice is called qualified on an exact head:

- SQLite proves canonical replay, changed-payload conflict and full rollback;
- migrated PostgreSQL proves same-key concurrency cannot drift to a second stage;
- migrated PostgreSQL proves revoke-while-waiting is revalidated after the project lock;
- actual mobile transport/restart proof preserves the exact body and request ID across response loss, restart and queue flush;
- full core backend/mobile/Playwright/Alembic gates remain green.

This contract does not close #316, #317, G04/G05 or GP1-GP8, and it does not replace the separate #424 cross-project stage-date mutation security fix.
