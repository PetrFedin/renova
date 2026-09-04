# Manual Payment Evidence Contract (#265)

Status: IMPLEMENTATION IN PROGRESS — schema/upload truth implemented; review/API/mobile qualification pending  
Base main at start: `4b1a0db5c600f3d728cf9836f77d86719c41b8b1`  
Current branch migration head: `w19paymentevidence01`  
External S3/provider/staging verification: NOT VERIFIED

## Canonical lifecycle

Customer manual transfer evidence follows one authoritative chain:

`Payment` → private versioned `PaymentEvidence` → `paid_unverified` → authorized review → `confirmed` → canonical payment-linked expense recognition.

`paid_unverified` is non-financial truth. Review approval MUST terminate through the existing canonical payment confirmation boundary and MUST NOT directly mutate `Project.budget_spent` or create a competing finance writer.

## Evidence truth

`backend/app/models/payment_evidence.py` and Alembic revision `w19paymentevidence01` introduce the authoritative versioned evidence table. Each evidence version is immutable historical metadata bound to exactly one `Payment` and its `Project`. A rejected version remains auditable. Resubmission creates a new version; it does not overwrite or delete the rejected version.

Persisted metadata: stable evidence id, project id, payment id, positive version, private storage key, original filename, declared/verified content type, byte size, SHA-256 digest, submitter, lifecycle status, rejection reason, reviewer identity and timestamps. `(payment_id, version)` and `storage_key` are unique at PostgreSQL truth.

Private object keys are payment-bound: `payment-evidence/{project_id}/{payment_id}/{evidence_id}/v{version}.{ext}`. They are never served through the generic unaffiliated `photos/*` contract.

## Two-phase storage contract

Implementation deliberately does not pretend PostgreSQL and S3 share one transaction.

1. `payment_evidence.upload_intent` persists a stable `PaymentEvidence` row and deterministic private object identity through canonical `ClientWriteRequest` before object-store write.
2. Client uploads to exactly that key (API surface still pending in this branch).
3. `payment_evidence.submit` reads the object back from authoritative storage.
4. Server validates actual magic bytes, maximum 10 MiB, declared-vs-actual MIME and computes SHA-256/size.
5. Only a successfully validated object changes evidence from `upload_pending` to `submitted` and moves an eligible payment to non-financial `paid_unverified`.

Current accepted evidence payload types are JPEG, PNG and PDF. Extension or client Content-Type alone is never sufficient.

This design means an ambiguous object write remains attached to a durable upload intent instead of becoming an unidentifiable public `photos/*` orphan. Provider-independent ambiguous-write/orphan reconciliation remains #238 and is NOT claimed complete here.

## Authorization

Submission: exact project customer only for the exact payment/project. `payment_evidence_service` checks both role and `Project.customer_id`; cross-project/payment/evidence identities fail closed.

Review target: explicit administrative identity via the existing configured `ADMIN_USER_IDS` production/staging contract plus exact project/payment binding. Ordinary contractor role alone is not sufficient to gain production administrative review authority. Review API is still pending implementation in this branch.

Read/download target: authenticated exact-project membership or authorized reviewer, with payment/project binding checked before signed access or local bytes are returned. Dedicated read API is still pending.

## Idempotency and concurrency

Upload-intent and submit mutations use the canonical `ClientWriteRequest` ledger. Same request id + same canonical payload replays the original result. Same request id + different payload conflicts.

Approve/reject races must collapse at PostgreSQL truth. Exactly one terminal decision may win for an evidence version. Duplicate approval must not duplicate `PaymentEvent`, expense recognition, budget facts, activity or notification effects. Review implementation and the mandatory real PostgreSQL race are still pending.

## Review semantics

- submitted evidence moves an eligible manual payment only to `paid_unverified`;
- approval is permitted only for the current submitted evidence version and an eligible `paid_unverified` payment;
- rejection requires a non-empty reason and makes that evidence version terminal rejected while keeping the payment non-financial;
- resubmission after rejection creates the next version and returns it to submitted review state;
- cancelled/disputed/refunded payments cannot be approved through evidence review;
- stage-payment acceptance rules remain authoritative.

## Side effects and audit

The implemented submit path reuses `payment_service.confirm_payment(... transfer_ack=True, commit=False)` for the `paid_unverified` transition, so its `PaymentEvent` and durable outbox rows participate in the same final `ClientWriteRequest` commit as evidence submission. No direct `Project.budget_spent` writer was introduced.

Review approval remains pending and must reuse/refactor the canonical confirmed-payment boundary rather than copy its finance logic.

## UI truth

Mobile/portal must distinguish at least: upload required, upload pending/retryable, submitted/pending review, rejected with reason/resubmit, confirmed, and terminal payment states. Ambiguous network/server failures must never render false success. UI/API wiring is pending.

## Qualification gate

Before merge:

- focused submit/replay/conflict/ACL/file-validation/reject/resubmit/terminal-state tests;
- real PostgreSQL concurrent approve/reject and duplicate-approve race;
- exact single finance-recognition assertion;
- storage failure/ambiguous retry contracts without promoting #238;
- mobile source/typecheck/state contracts;
- full backend regression + PostgreSQL Alembic upgrade;
- Playwright/API E2E where applicable;
- exact-head CI green;
- living technical specification and production-readiness reconciliation after merge.

No implementation-in-progress commit in this PR is production/readiness evidence until these gates pass on the exact final head.