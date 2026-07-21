# Portal payment evidence — manual bank transfer verification

## State machine (canonical `PaymentStatus`)

```
pending | processing | rejected
        │  submit evidence (+ file)
        ▼
  paid_unverified  ←── resubmit after reject
        │
        ├── approve (contractor) → confirmed  (+ budget_spent)
        └── reject (reason)      → rejected
```

- **Submit never means confirmed.** YuKassa webhook / receipt confirm paths remain separate.
- Existing `paid_unverified` reused (no parallel `pending_verification`).
- New status: **`rejected`** (resubmittable). `disputed` / `cancelled` unchanged.

Optimistic locking: `Payment.lock_version` increments on submit/approve/reject. Concurrent second review → `409 concurrent_review`.

## Permissions

| Action | Who |
|--------|-----|
| Submit / replace evidence | Customer (`user.id == project.customer_id`) |
| Approve / reject | Contractor (`user.id == project.contractor_id`) |
| Download file | Project membership (read) |
| Set `verified_by` / `reviewed_by` | Server only — client payload ignored |

Foreign project → 404/403. No admin role in product.

## File security

- Allowed: PDF, JPEG, PNG (magic-byte check; client MIME not trusted).
- Max size: 20 MB (`MAX_EVIDENCE_BYTES`).
- Storage key: UUID + hash under `documents/{project_id}/payments/{payment_id}/` (no original filename in path).
- Metadata: original filename, MIME, size, sha256, uploader, created_at.
- Download: authenticated `GET .../evidence/file` only — bucket not public.
- **Antivirus:** not configured. `antivirus_scanned=false`, `antivirus_status=not_configured`. Do not claim scanning.

## API

| Method | Path |
|--------|------|
| POST | `/api/v1/projects/{id}/payments/{payment_id}/evidence` (multipart) |
| GET | `/api/v1/projects/{id}/payments/{payment_id}/evidence` |
| GET | `/api/v1/projects/{id}/payments/{payment_id}/evidence/file` |
| POST | `/api/v1/projects/{id}/payments/{payment_id}/evidence/approve` |
| POST | `/api/v1/projects/{id}/payments/{payment_id}/evidence/reject` |

Idempotency: `Idempotency-Key` header or `client_request_id` form field. Scope `(payment_id, key)`.

## Audit (`payment_events`)

- submit / replace → `bank_statement` / `transfer_screenshot`
- approve / reject → `manual_review`
- download → `download`
- Always: `actor_user_id`, timestamps. Reject note truncated; no full PII dump.

## Notifications

- Submit → contractor `payment_pending` («Квитанция на проверку»)
- Approve → customer `payment_confirmed`
- Reject → customer `payment_pending` with reason
- Idempotent replay → **no** duplicate notify

## Migration

- `w6payev01` (revises `w4jtipurge01`)
- Adds `payments.lock_version`, enum `rejected`, table `payment_evidence`
- Rollback: `alembic downgrade w4jtipurge01` (drops table + column; Postgres enum value `rejected` may remain)

## Known limitations

- No antivirus pipeline.
- Portal review UI is customer-first; contractor review via same sheet / budget API.
- YuKassa live checkout remains the card path — evidence is for requisites/SBP only.
