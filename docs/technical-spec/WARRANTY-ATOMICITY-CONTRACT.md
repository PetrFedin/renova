# Renova — Warranty atomicity and idempotency contract

**Status:** CI VERIFIED / MERGED  
**Issue:** #266 — CLOSED  
**Implementation:** PR #295  
**Exact qualified head:** `22dd1f2d379f3d2f26278b58b03a1ca4f022da3c`  
**Merge SHA:** `9fed24c1b59d767daef4d6395fd01cb303c838e3`  
**Historical reference:** PR #287 only; current implementation was rebuilt from current `main`.

## Canonical E2E path

`Documents hub → authenticated mobile request → project write ACL → validated payload + stable client_request_id → ClientWriteRequest → ProjectIssue + warranty ProjectDocument → activity/notification DomainOutbox → one PostgreSQL commit → optional inline acceleration → renova-worker retry/DLQ/recovery → canonical response → list/read → customer close → closeout reconciliation`.

## Transaction invariant

One create action is one transaction containing Issue, warranty Document and initial version, ClientWriteRequest, activity outbox and opposite-party notification outbox when applicable. Pre-commit failure leaves no durable partial result. Post-commit delivery failure leaves durable outbox work for the worker.

## Idempotency invariant

Identity is `scope + project_id + user_id + client_request_id + canonical payload hash`.

- same key + same payload returns the original canonical Issue/Document;
- changed payload under the same key returns 409;
- concurrent PostgreSQL writers collapse to one result/effect set;
- timeout-after-commit and offline replay preserve request identity;
- no warranty-specific idempotency table is introduced.

## Async rollback invariant

`commit_client_write` may rollback a losing concurrent transaction. ORM Project state may then be expired. The service therefore captures scalar `project_id` and `post_closeout` before the race and reconstructs only from those scalars plus explicit fresh queries. Post-rollback ORM Project dereference is forbidden.

## Route/compatibility invariant

Exactly one POST create handler is composed. Legacy create is removed before the canonical router is included; existing GET list and POST close remain. Warranty remains allowed after closeout. Open warranty claims block closeout before archival; customer close removes that blocker and archives the linked warranty document.

The route-composition source changed in this contour and is traceability-bound here, as permitted by the master dossier rule that an affected source may be synchronized in the corresponding annex in the same change:

| Source | Blob SHA | Что подтверждает |
|---|---|---|
| `backend/app/api/v1/router.py` | `292dd48b37b77cc408db9f0c215ad7a5007e6cd0` | canonical warranty POST replacement + preservation of legacy list/close composition |

The master dossier's older router snapshot is historical until the next consolidated documentation snapshot refresh; this annex is authoritative for the warranty contour and must be read together with the master dossier.

## Mobile retry invariant

Mobile creates `client_request_id` before first network attempt and serializes once. Deterministic 4xx is not queued. Network/status-0 and ambiguous 5xx enqueue the exact serialized body. Offline flush replays stored body without regenerating identity.

## Exact-head evidence

PR #295 was qualified on exact head `22dd1f2d379f3d2f26278b58b03a1ca4f022da3c` before merge.

- `Warranty claim PostgreSQL integrity` run `33795110887`: success.
- Job `warranty-postgres-race` / `100780813427`: canonical Alembic upgrade, warranty atomicity/mobile identity contracts and **real concurrent PostgreSQL race** all executed and passed; the race step was not skipped.
- Full `CI` run `33795110854` (`#4557`): success. `backend-complete` passed the full backend suite and PostgreSQL Alembic upgrade; Playwright API/UI, mobile, chat-message, stage-mutation, acceptance-decision, team-lifecycle and project-creation jobs passed.
- Exact-head CodeQL, Security operations, Backend image, technical-spec, payment and other triggered integrity workflows reported success.
- PR #295 squash-merged as `9fed24c1b59d767daef4d6395fd01cb303c838e3`; #266 closed automatically.

## GP4 evidence-backed resolution extension

**Status:** IMPLEMENTED / exact-head CI pending in the evidence-close change.

Resolution now follows a fail-closed evidence contract:

`contractor response → project-scoped media upload → physical storage read proof → claim fixed → customer verification → close → linked warranty document archived`.

- `fixed` requires a canonical `project-media/{project_id}/…` key and the referenced bytes must exist in configured storage.
- foreign-project/unscoped evidence is rejected; storage unavailability is a retryable 503 and does not change claim state.
- historical `fixed` claims without evidence can be backfilled by repeating `fixed` with evidence.
- once evidence is fixed on the current claim cycle it cannot be silently replaced; a new correction requires reopen first.
- customer close is allowed only from `fixed` with evidence, or from `rejected` when the contractor has already supplied the mandatory rejection reason.
- `open` / `in_progress` claims cannot be prematurely closed from the mobile UI or backend.

The current `ProjectIssue.photo_key` is the evidence pointer for the active resolution cycle. It is not yet an immutable multi-version warranty evidence ledger; that stronger history is a prerequisite for a future Verified Execution Record / Property Passport and remains outside this contour.

## Residual boundary

This contract proves repository/CI correctness for the warranty create contour only. It does **not** claim external storage/provider/staging/production readiness. S3 ambiguous-write/orphan recovery remains #238. The next product-integrity priority is #265 manual payment evidence lifecycle.
