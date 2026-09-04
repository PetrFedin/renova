# Manual Payment Evidence Contract (#265)

Status: BACKEND CI VERIFIED ON CURRENT CANDIDATE — mobile lifecycle/exact-head final qualification pending  
Base main at start: `4b1a0db5c600f3d728cf9836f77d86719c41b8b1`  
Current branch migration head: `w19paymentevidence01`  
Dedicated PostgreSQL race run: `33884768347` — SUCCESS  
External S3/provider/staging verification: NOT VERIFIED

## Source snapshot owned by this annex

| Source | Blob SHA | What this annex owns |
|---|---|---|
| `backend/app/api/v1/router.py` | `a9ebc3fa5adfa2dbb4620497370626d33fe29f41` | canonical payment-evidence API composition |

## Canonical lifecycle

Customer manual transfer evidence follows one authoritative chain:

`Payment` → private versioned `PaymentEvidence` → `paid_unverified` → authorized review → `confirmed` → canonical payment-linked expense recognition.

`paid_unverified` is non-financial truth. Approval reuses `payment_service.confirm_payment(... reviewed_evidence_id=..., commit=False)` and therefore the existing `Payment → Expense → refresh_budget_facts` boundary. No direct `Project.budget_spent` writer or competing financial path is introduced.

## Evidence truth

`backend/app/models/payment_evidence.py` and Alembic revision `w19paymentevidence01` own the authoritative versioned evidence table. Persisted metadata includes stable evidence id, project/payment binding, positive version, private storage key, original filename, declared/verified MIME, byte size, SHA-256, submitter, lifecycle status, rejection reason, reviewer and timestamps. `(payment_id, version)` and `storage_key` are unique at database truth.

A rejected version remains immutable history. A subsequent upload intent is allowed only after the latest version is rejected and creates version N+1; it never overwrites the rejected row.

## Two-phase private storage

1. `payment_evidence.upload_intent` durably creates a stable evidence id/key through `ClientWriteRequest`.
2. The upload is bound to `payment-evidence/{project}/{payment}/{evidence}/vN.ext`.
3. S3 mode returns an exact-key/content-type presigned PUT; local canonical runtime uses the authenticated exact-evidence PUT endpoint.
4. The server upload endpoint streams with a 10 MiB cap and validates magic/MIME before writing.
5. `payment_evidence.submit` independently reads the stored object back, validates JPEG/PNG/PDF magic, declared-vs-actual MIME, size and SHA-256, then changes truth to `submitted`.
6. Only after validation can an eligible payment move to `paid_unverified`.

No generic public `photos/*` URL is used for evidence. Read is through an authenticated project/payment/evidence route; S3/CloudFront may redirect only after ACL and exact binding are checked, while local bytes use `private, no-store`.

An ambiguous provider write can still exist outside the database transaction. The durable intent makes it identifiable, but provider-independent orphan/ambiguity reconciliation remains #238 and is NOT VERIFIED by #265.

## Authorization

Upload/submit: exact project customer (`UserRole.customer` and `Project.customer_id == user.id`) plus exact Payment/PaymentEvidence binding.

Review: `require_admin_user`; staging/production therefore require an immutable identity configured in `ADMIN_USER_IDS`. Ordinary contractor membership does not grant production review authority.

Read/list: authenticated project access or a valid administrative reviewer. Object key is never accepted from the caller; it is loaded from the evidence row after project/payment/evidence binding.

## Idempotency and concurrency

Upload intent, submit and review use canonical `ClientWriteRequest` scopes. Same request id + same canonical payload replays; changed payload conflicts.

Review uses conditional SQL `UPDATE payment_evidence ... WHERE status='submitted'`. Approve/reject therefore share one PostgreSQL winner boundary. Approval then enters canonical payment confirmation inside the same uncommitted business transaction; failure rolls the evidence decision back. The final `ClientWriteRequest` commit contains the review row, payment transition, `PaymentEvent`, canonical finance mutation and durable outbox rows.

Real two-session PostgreSQL qualification is now verified on candidate `a30090326b773afe683b7da519e6e8681d078bd5` by workflow run `33884768347`: duplicate approve collapses to one canonical result/finance recognition and approve↔reject has exactly one terminal winner. This is CI evidence only; it does not promote external staging/provider status.

## Review semantics

- `submitted` + approve → evidence `approved` and payment `paid_unverified → confirmed`;
- confirmed PaymentEvent provenance is `evidence_type=payment_evidence`, `evidence_ref=<evidence_id>`, `source=manual_review`;
- reject requires a non-empty reason and leaves the payment non-financial in `paid_unverified`;
- rejected version is terminal; new upload intent creates the next version;
- confirmed/cancelled/disputed/refunded states cannot be bypassed through evidence review;
- stage acceptance remains enforced by canonical payment confirmation.

`payment_evidence.review` also prepares durable activity plus customer notification in `DomainOutbox`. Approval additionally retains the canonical payment transition outbox. Provider delivery remains post-commit retryable truth.

## API surface implemented

- `POST /api/v1/projects/{project_id}/payments/{payment_id}/evidence/upload-intent`
- `PUT /api/v1/projects/{project_id}/payments/{payment_id}/evidence/{evidence_id}/content`
- `POST /api/v1/projects/{project_id}/payments/{payment_id}/evidence/{evidence_id}/submit`
- `GET /api/v1/projects/{project_id}/payments/{payment_id}/evidence`
- `GET /api/v1/projects/{project_id}/payments/{payment_id}/evidence/{evidence_id}/content`
- `POST /api/v1/projects/{project_id}/payments/{payment_id}/evidence/{evidence_id}/review`

The routes are registered directly in canonical API composition; no generic media mutation is used.

## UI truth still pending

Mobile/portal must distinguish upload required, upload pending/retryable, submitted/pending review, rejected with reason/resubmit, confirmed and terminal payment states. `paid_unverified` must not disappear from progress/read models and ambiguous network/server failures must never render false success.

## Qualification gate before merge

Completed on backend candidate:
- focused content validation/private API contracts;
- real PostgreSQL concurrent approve/reject and duplicate-approve race;
- exact single finance-recognition assertion;
- clean PostgreSQL Alembic upgrade to `w19paymentevidence01`;
- full backend CI on run `33884768397`.

Still required:
- mobile upload/status/reject/resubmit truth and offline/no-false-success behavior;
- exact-head rerun after mobile/spec changes;
- post-merge living ТЗ/readiness evidence reconciliation.

No implementation-in-progress commit in draft PR #297 is production/readiness evidence until all remaining gates pass on its exact final head.