# Warranty claim — fail-closed list + idempotent create

## Idempotency scheme

| Layer | Mechanism |
|-------|-----------|
| Header | `Idempotency-Key: <uuid>` |
| Body | `client_request_id` (для offline queue) |
| Store | table `warranty_claim_idempotency` |
| Scope | `(user_id, project_id, idempotency_key)` unique |
| Payload | SHA-256 of normalized `{title, description, category, related_*, work_order, acceptance}` |

- Same key + same payload → `200` + `idempotent_replay: true` (same `issue_id`).
- Same key + different payload → `409` `warranty_claim_idempotency_conflict`.
- No key → create without idempotency (backward compatible).

## Migration

- Revision: `w5warranty01` (revises `w4jtipurge01`)
- File: `backend/alembic/versions/w5warranty01_warranty_claim_idempotency.py`
- Constraint: `uq_warranty_claim_idempotency_scope`

### Rollback plan

```bash
cd backend && alembic downgrade w4jtipurge01
# DROP TABLE warranty_claim_idempotency only — ProjectIssue / documents untouched
```

Existing warranty issues (title prefix `[Гарантия]`) continue to list/close without the table.

## Audit kinds (no full defect description)

- `warranty_claim_created`
- `warranty_claim_idempotent_replay`
- `warranty_claim_conflict`

## Soft business duplicate

Response may include `duplicate_hint` / `similar_open_count` when open warranty already exists on the project. **No** hard unique on project/text.

## Mobile

- List error ≠ empty; create fail-closed until list loads.
- Refresh error keeps stale list + warning.
- Double-tap blocked; timeout retry reuses key; new submit → new key.
