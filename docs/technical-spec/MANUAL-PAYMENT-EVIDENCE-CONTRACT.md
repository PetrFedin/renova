# Manual Payment Evidence Contract (#265)

Status: IMPLEMENTED — exact-head final qualification pending  
Base main at start: `4b1a0db5c600f3d728cf9836f77d86719c41b8b1`  
Current branch migration head: `w19paymentevidence01`  
Current authoritative base after sync: includes merged #304/#301 and #306/#303 lifecycle fixes  
External S3/provider/staging verification: NOT VERIFIED

## Source snapshot owned by this annex

| Source | Blob SHA | What this annex owns |
|---|---|---|
| `backend/app/api/v1/router.py` | `2f13883394a1ec8206d11f2b9cb758d9473abb4a` | canonical payment-evidence API composition |

The canonical implementation is the current PR #297 head. This annex owns the behavior of:

- `backend/app/api/v1/payment_evidence.py`;
- `backend/app/models/payment_evidence.py`;
- `backend/app/services/payment_evidence_service.py`;
- `backend/app/services/payment_service.py` only at the reviewed-evidence confirmation boundary;
- `apps/mobile/components/renova/PaymentEvidenceSheet.tsx`;
- `apps/mobile/lib/api/payments.ts`;
- the dedicated focused/PostgreSQL/mobile contracts listed below.

## Canonical lifecycle

Customer manual transfer evidence follows one authoritative chain:

`Payment` → private versioned `PaymentEvidence` → `paid_unverified` → authorized review → `confirmed` → canonical payment-linked expense recognition.

`paid_unverified` is non-financial truth. Approval reuses `payment_service.confirm_payment(... reviewed_evidence_id=..., commit=False)` and therefore the existing `Payment → Expense → refresh_budget_facts` boundary. No direct `Project.budget_spent` writer or competing financial path is introduced.

## Evidence truth

`backend/app/models/payment_evidence.py` and Alembic revision `w19paymentevidence01` own the authoritative versioned evidence table. Persisted metadata includes stable evidence id, project/payment binding, positive version, private storage key, original filename, declared/verified MIME, byte size, SHA-256, submitter, lifecycle status, rejection reason, reviewer and timestamps. `(payment_id, version)` and `storage_key` are unique at database truth.

A rejected version remains immutable history. A subsequent upload intent is allowed only after the latest version is rejected and creates version N+1; it never overwrites the rejected row.

## Private upload and immutable-content boundary

1. `payment_evidence.upload_intent` durably creates a stable evidence id/key through `ClientWriteRequest`.
2. The upload is bound to `payment-evidence/{project}/{payment}/{evidence}/vN.ext`.
3. Financial evidence is uploaded only through the authenticated exact project/payment/evidence `PUT` route. A reusable direct presigned S3 `PUT` is intentionally not returned.
4. The server upload endpoint streams with a 10 MiB cap and validates magic/MIME before writing.
5. Upload holds a database lock on the exact evidence row across the storage write. `payment_evidence.submit` takes the same row lock before reading the object back. Therefore a late/replayed upload cannot overwrite bytes after `submitted`/SHA-256 truth has been committed.
6. `payment_evidence.submit` independently validates JPEG/PNG/PDF magic, declared-vs-actual MIME, size and SHA-256, then changes truth to `submitted`.
7. Only after validation can an eligible payment remain/move to `paid_unverified` pending review.

Read access remains through the exact project/payment/evidence route. S3/CloudFront may provide a signed GET only after the caller has passed the narrow evidence ACL and exact evidence binding. Local bytes use `private, no-store`.

An ambiguous provider write can still exist outside the database transaction. The durable intent and deterministic key make it identifiable and retryable while the row is `upload_pending`, but provider-independent orphan/ambiguity reconciliation remains #238 and is NOT VERIFIED by #265.

## Authorization and privacy boundary

Upload/submit: exact project customer (`UserRole.customer` and `Project.customer_id == user.id`) plus exact Payment/PaymentEvidence binding.

Review: `require_admin_user`; staging/production therefore require an immutable identity configured in `ADMIN_USER_IDS`. Ordinary contractor membership does not grant production review authority.

Read/list: exact project customer or a valid administrative reviewer only. Generic project-read access is deliberately insufficient: contractor team members, project guests and technical-supervision read fallback do not gain access to bank-transfer evidence merely because they can view the project. Object key is never accepted from the caller; it is loaded from the evidence row after project/payment/evidence binding.

## Idempotency and concurrency

Upload intent, submit and review use canonical `ClientWriteRequest` scopes. Same request id + same canonical payload replays; changed payload conflicts.

Upload-intent version allocation is serialized on the parent `Payment` row before `max(version)+1` and the active-evidence check. A request that waited on the lock rechecks its idempotency mapping after acquiring the lock. This prevents both duplicate version allocation and a false conflict for a concurrent retry of the same logical request.

The dedicated PostgreSQL suite must prove two upload-intent cases:

- concurrent same key/payload → one evidence version, one ledger mapping, one replay;
- concurrent independent intents → exactly one `upload_pending` winner; the other receives `active_evidence_exists`, never a database integrity 500.

Review uses conditional SQL `UPDATE payment_evidence ... WHERE status='submitted'`. Approve/reject therefore share one PostgreSQL winner boundary. Approval then enters canonical payment confirmation inside the same uncommitted business transaction; failure rolls the evidence decision back. The final `ClientWriteRequest` commit contains the review row, payment transition, `PaymentEvent`, canonical finance mutation and durable outbox rows.

The dedicated PostgreSQL suite must also prove:

- duplicate approve collapses to one canonical result and one finance recognition;
- concurrent approve↔reject has exactly one terminal winner;
- the losing request cannot create a second `PaymentEvent` or `Expense`.

These are repository/CI proofs only; they do not promote external staging/provider status.

## Focused lifecycle and negative contracts

The focused backend suite must execute, not merely document:

- JPEG/PNG/PDF magic and MIME matching plus the 10 MiB limit;
- upload-intent replay and same-key/different-payload conflict;
- outsider/wrong-project rejection;
- only one active evidence version before rejection;
- missing storage object leaves evidence retryable as `upload_pending`;
- submit replay returns the same evidence;
- first valid submit moves an eligible manual payment to `paid_unverified` without creating an `Expense`;
- reject requires a reason and preserves non-financial payment truth;
- rejected v1 permits a new immutable v2;
- cancelled/disputed/refunded payments cannot start a new evidence lifecycle;
- generic project readers are not evidence readers.

## Review semantics

- `submitted` + approve → evidence `approved` and payment `paid_unverified → confirmed`;
- confirmed `PaymentEvent` provenance is `evidence_type=payment_evidence`, `evidence_ref=<evidence_id>`, `source=manual_review`;
- reject requires a non-empty reason and leaves the payment non-financial in `paid_unverified`;
- rejected version is terminal; new upload intent creates the next version;
- confirmed/cancelled/disputed/refunded states cannot be bypassed through evidence review;
- stage acceptance remains enforced by canonical payment confirmation.

`payment_evidence.review` also prepares durable activity plus customer notification in `DomainOutbox`. Approval additionally retains the canonical payment transition outbox. Provider delivery remains post-commit retryable truth.

## Mobile UX / design-system contract (#305 parallel stream)

The payment-evidence flow uses the existing `SheetSurface`, `PrimaryButton`, `InfoBanner`, `RenovaTheme` spacing/typography/radius tokens and shared API error handling. It does not create a second visual system.

Required behavior:

- clear Russian states: upload required, upload interrupted, pending review, rejected with reason, accepted;
- no internal idempotency/request terminology in customer-facing copy;
- no false-success message before authoritative server refresh;
- retry within the open sheet retains the same logical request identifiers;
- after reopening, an existing `upload_pending` version can resume through the authenticated evidence endpoint rather than attempting to create a second intent;
- resume requires the original filename and declared MIME, preserving evidence metadata truth;
- evidence CTA is rendered only when the current role actually has write capability, preventing visible actions that can only fail with 403;
- all footer actions use shared button semantics, busy/disabled states and minimum touch targets;
- history is rendered with Russian status labels and canonical design tokens rather than raw backend enum values.

## API surface implemented

- `POST /api/v1/projects/{project_id}/payments/{payment_id}/evidence/upload-intent`
- `PUT /api/v1/projects/{project_id}/payments/{payment_id}/evidence/{evidence_id}/content`
- `POST /api/v1/projects/{project_id}/payments/{payment_id}/evidence/{evidence_id}/submit`
- `GET /api/v1/projects/{project_id}/payments/{payment_id}/evidence`
- `GET /api/v1/projects/{project_id}/payments/{payment_id}/evidence/{evidence_id}/content`
- `POST /api/v1/projects/{project_id}/payments/{payment_id}/evidence/{evidence_id}/review`

The routes are registered directly in canonical API composition; no generic public media mutation is used.

## Qualification gate before merge

Required on the exact final PR head:

- focused lifecycle/negative/private API contracts;
- authenticated-upload immutability contract;
- real PostgreSQL concurrent upload-intent races;
- real PostgreSQL concurrent approve/reject and duplicate-approve races;
- exact single finance-recognition assertion;
- clean PostgreSQL Alembic upgrade to `w19paymentevidence01`;
- full backend regression;
- mobile source contracts/typecheck;
- Playwright/API/UI E2E where the canonical CI matrix applies;
- technical-spec/security/integrity gates.

No external S3 provider, staging deployment, alert delivery or production readiness is inferred from these tests. Those remain governed by #238 and the later staging/observability/DR/load/security sequence.