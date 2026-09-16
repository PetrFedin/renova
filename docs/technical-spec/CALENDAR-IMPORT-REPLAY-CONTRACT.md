# RENOVA calendar import replay contract

Status: P0 recovery contract for #422, child of #316. This slice is stacked on #419 and transitively on #322. It must be requalified after its upstream recovery/security bases are owner-merged.

## Business intent

`POST /projects/{project_id}/calendar/import` imports one iCalendar payload as one logical client intent.

`client_request_id` is minted before the first send. The same serialized request body, including the original ICS content and request ID, must survive offline queue persistence and application restart. Two separate user invocations with identical visible ICS content are separate intents and must receive different request IDs.

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
-> apply all mapped dates and external/local ical_uid values in memory
-> persist ClientWriteRequest result ledger
-> one database commit
```

No per-stage commit is allowed inside import.

## Mapping and stage-identity semantics

For each parsed event, matching preserves the legacy priority:

1. current `ical_uid` or a UID suffix matching the stage ID;
2. case-insensitive title/name containment;
3. first originally-unscheduled stage by canonical stage order.

Fallback allocation is resolved against the original snapshot plus stages already consumed earlier in the same import. Explicit UID/title matches may still target a previously matched stage, preserving the legacy last-explicit-event-wins behavior without allowing replay to drift to another fallback stage.

All selected Stage rows come from a `Stage.project_id == URL project_id` query before mutation. A foreign stage ID is never an input to the import write path.

Atomic import must preserve the legacy `stage_svc.update_stage_dates()` identity invariant that existed before this refactor: if a mapped external event has no UID and the Stage has no existing `ical_uid`, the Stage receives `renova-{stage.id}@app`. An external UID still replaces/sets the Stage `ical_uid` exactly as before. This keeps UID-less imported stages stable for subsequent Renova iCalendar export while avoiding the old per-stage commits.

## Replay and rollback semantics

- same user/project/request ID + same canonical ICS payload returns the original `{parsed, updated_stages}` result without reapplying mapping;
- same request ID + changed canonical content raises `idempotency_conflict`;
- response loss after commit cannot move an unmatched event from the first empty stage to the next empty stage;
- concurrent same-key imports serialize on the project lock and produce one ledger entry and one canonical stage mapping;
- rollback qualification must first force the dirty Stage rows through real SQL UPDATE statements inside the open transaction, then inject failure before ledger/transaction commit; rollback must restore every date/UID and leave no ledger row;
- after that transient post-flush/pre-commit failure is removed, retrying the exact same request ID/content must complete once and create exactly one ledger entry.

The compact replay result is encoded in `ClientWriteRequest.entity_id`; no new schema or response-snapshot table is required.

## Authorization after lock wait

Because project-lock acquisition can block, write authority is re-read after the lock is acquired. If an assigned contractor is revoked while waiting, the import fails with 403 and persists no Stage mutation or replay ledger.

Qualification must observe the production lock path. A `gather()` or fixed sleep alone is not physical-concurrency evidence: the same-key race must prove two independent sessions reach the project-lock boundary before release, and the revocation scenario must prove the importer remains blocked while another transaction owns the PostgreSQL Project row lock before authority is removed.

## Mobile retry policy

After server replay safety exists, mobile queues the exact serialized request for:

- normalized transport/status `0` failures;
- ambiguous successful transport where the 2xx response body is unreadable and server commit may already have happened;
- HTTP 429;
- HTTP 5xx.

Other deterministic HTTP 4xx responses are authoritative and must not be converted into queued success. Failure to persist the queue remains an error.

## Required qualification

Before this slice is called qualified on an exact head:

- SQLite explicitly executes canonical replay/changed-payload conflict, UID-less local-`ical_uid` preservation, plus post-SQL-flush rollback and same-intent recovery;
- migrated PostgreSQL explicitly executes the same-key physical serialization scenario and the revoke-while-waiting authority-recheck scenario;
- the mandatory Calendar integrity workflow emits JUnit and requires all five exact calendar-import testcase names (three behavioral, two PostgreSQL); any missing, skipped, failing or erroring required testcase fails qualification;
- actual production mobile transport/restart harness is invoked directly from mandatory core CI and proves exact-body/request-ID persistence across lost response, corrupt-2xx ambiguity, restart and queue flush; deterministic 4xx must not queue, 429/5xx/status-0 must queue, storage failure must fail closed, and two separate equal-visible imports must mint distinct request IDs;
- full core backend/mobile/Playwright/Alembic gates remain green;
- qualification artifacts retain the calendar log and behavioral/PostgreSQL JUnit files for inspection.

This contract does not close #316, #317, G04/G05 or GP1-GP8, and it does not replace the separate #424 cross-project stage-date mutation security fix.
