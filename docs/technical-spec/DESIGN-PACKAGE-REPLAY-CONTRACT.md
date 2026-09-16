# Design package create — response-loss contract

Status: bounded P0 candidate for issue #413 / parent #316. This document does not close #316 or G04.

## Canonical create identity

`POST /api/v1/projects/{project_id}/design-packages` requires `client_request_id` (8–80 URL-safe characters). Title, file key and notes are canonicalized payload; they are never used as identity. The mobile client creates the ID before its first network attempt and persists the exact serialized body when a replay-safe ambiguous failure is queued.

- same user/project/request ID + same canonical payload → original package/version, `replayed=true`;
- same identity + changed payload → `409 idempotency_conflict`;
- two different IDs with identical title/file/notes → two deliberate design versions.

## Transaction boundary

The service locks and refreshes the project row, revalidates current executor authority, rechecks replay after any lock wait, allocates the next version, prepares one `DesignCreated` activity outbox row and commits:

`DesignPackage + DomainOutbox + ClientWriteRequest`

as one transaction. A competing duplicate may not leave a second version or second activity row. Inline outbox dispatch runs only after the canonical commit; durable worker delivery remains authoritative if inline delivery fails.

## Replay/transport boundary

Deterministic `400/401/403/404/409/422` is authoritative and is not queued. For this now replay-safe create only, status `0`, `429`, ambiguous `5xx`, transport failure or malformed committed response may be persisted with the original ID/body. Failure to persist the queue is surfaced; it is never reported as `offline_queued`.

## Executable evidence

- `backend/tests/test_design_package_replay.py` — replay, conflict, equal-payload distinct intents, package/request/outbox cardinality.
- `backend/tests/test_design_package_replay_postgres.py` — migrated PostgreSQL lock contention and same-key race.
- `scripts/designPackageTransport.test.mjs` — actual mobile `req → AsyncStorage queue → restart → flush` and failure classification.
- The PostgreSQL race is imported by an already-selected test module in the existing dedicated migrated PostgreSQL chat/recovery CI job; the general SQLite run is not used as concurrency evidence.

## Explicitly out of scope

Submit/approve/reject transition replay semantics, native file-byte lifecycle, #320, central transport classification #317, session generation #315 and G04/G05 remain separate work.