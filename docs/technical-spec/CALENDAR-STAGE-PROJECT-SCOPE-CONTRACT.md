# Calendar stage project-scope mutation contract

**Status:** ACTIVE / GOVERNED SECURITY ANNEX

## Purpose

Calendar stage-date writes are child-resource mutations. Authorization of `/projects/{project_id}` is not sufficient unless the mutated `Stage` is proven to belong to that same project before any field change or commit.

## Canonical write invariant

For `PATCH /api/v1/projects/{project_id}/calendar/stages`, the write path is:

`authenticated actor -> writable project authorization -> contractor role gate -> project-scoped Stage lookup -> date/ical mutation -> commit -> authoritative calendar read`.

The Stage mutation query must constrain both:

- `Stage.id == stage_id`; and
- `Stage.project_id == project_id`.

A stage outside the authorized project is therefore indistinguishable from a missing child resource for this route and returns `404` without changing that stage.

The forbidden sequence is:

`authorize Project A -> load Stage B by id only -> mutate/commit Stage B -> discover project mismatch`.

A response code after such a commit would not repair the security breach.

## iCalendar import boundary

Calendar import may identify a stage only from the already-authorized project's stage set and sends the resulting id through the same project-scoped mutation helper. This annex does **not** claim import-level all-or-nothing replay/transaction semantics; that independent recovery gap is tracked by #422.

## Verification

The dedicated calendar integrity suite must prove at least:

1. an actor authorized to Project A cannot change dates or `ical_uid` of a Stage owned by Project B;
2. persisted Project B truth remains unchanged after the rejected attempt and transaction cleanup;
3. a valid Project A Stage update still commits the requested dates and canonical Renova iCal UID;
4. the tests re-read persisted truth using stable scalar ids rather than relying on expired ORM attributes after rollback/commit.

The security assertion is about database truth, not merely the HTTP status returned to the caller.

## Evidence boundary

This contract covers calendar stage-date project binding only. It does not broaden contractor authority, complete independent-contractor scope adoption (#300), make iCalendar import replay-safe (#422), or prove staging/production behavior. Exact-candidate CI and the dedicated calendar integrity workflow are required before merge review.
