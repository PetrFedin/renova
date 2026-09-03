# Manual Payment Evidence Contract (#265)

Status: IMPLEMENTATION IN PROGRESS  
Base main at start: `4b1a0db5c600f3d728cf9836f77d86719c41b8b1`  
External S3/provider/staging verification: NOT VERIFIED

## Canonical lifecycle

Customer manual transfer evidence follows one authoritative chain:

`Payment` → private versioned `PaymentEvidence` → `paid_unverified` → authorized review → `confirmed` → canonical payment-linked expense recognition.

`paid_unverified` is non-financial truth. Review approval MUST terminate through the existing canonical payment confirmation boundary and MUST NOT directly mutate `Project.budget_spent` or create a competing finance writer.

## Evidence truth

Each evidence version is immutable historical metadata bound to exactly one `Payment` and its `Project`. A rejected version remains auditable. Resubmission creates a new version; it does not overwrite or delete the rejected version.

Required metadata includes stable evidence id, project id, payment id, version, private storage key, declared/verified content type, byte size, digest, submitter, review status, rejection reason when rejected, reviewer identity and timestamps.

Private object keys are payment-bound (`payment-evidence/{project_id}/{payment_id}/...`) and are never served through the generic unaffiliated `photos/*` contract.

## Authorization

Submission: project customer only for the exact payment/project.

Review: explicit administrative identity via the existing `require_admin_user` production/staging contract and exact project/payment authorization. Ordinary contractor role alone is not sufficient to gain production administrative review authority.

Read/download: authenticated exact-project membership or authorized reviewer, with payment/project binding checked before signed access or local bytes are returned.

## Idempotency and concurrency

Critical submit/review mutations use the canonical `ClientWriteRequest` ledger. Same request id + same canonical payload replays the original result. Same request id + different payload conflicts.

Approve/reject races must collapse at PostgreSQL truth. Exactly one terminal decision may win for an evidence version. Duplicate approval must not duplicate `PaymentEvent`, expense recognition, budget facts, activity or notification effects.

## Review semantics

- submitted evidence moves an eligible manual payment only to `paid_unverified`;
- approval is permitted only for the current submitted evidence version and an eligible `paid_unverified` payment;
- rejection requires a non-empty reason and makes that evidence version terminal rejected while keeping the payment non-financial;
- resubmission after rejection creates the next version and returns it to submitted review state;
- cancelled/disputed/refunded payments cannot be approved through evidence review;
- stage-payment acceptance rules remain authoritative.

## Storage boundary

Upload identity must be stable across ambiguous client retry. File validation is fail-closed for supported MIME/magic, maximum size and exact private key binding. A database success MUST NOT claim that an external S3 write was proven when storage confirmation is ambiguous.

Provider-independent ambiguous-write/orphan reconciliation remains tracked by #238. This contract may add deterministic identity and recovery metadata but does not close #238 without its separate provider/recovery evidence.

## Side effects and audit

Authoritative evidence mutation/review decision, payment transition, `PaymentEvent`, audit/activity intent and `DomainOutbox` rows commit in the same business transaction where applicable. Worker/provider delivery is post-commit retryable truth; inline delivery is only an optimization.

## UI truth

Mobile/portal must distinguish at least: upload required, upload pending/retryable, submitted/pending review, rejected with reason/resubmit, confirmed, and terminal payment states. Ambiguous network/server failures must never render false success.

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
