# Selection create — response-loss contract

Status: bounded P0 candidate for issue #415 / parent #316. This document does not close #316 or G04.

## Canonical create identity

`POST /api/v1/projects/{project_id}/selections` requires `client_request_id` (8–80 URL-safe characters). Selection fields are canonical payload, never identity. Mobile creates the ID before the first network attempt and retains the exact serialized body for durable replay.

- same user/project/request ID + same canonical payload → original SelectionItem, `replayed=true`;
- same identity + changed payload → `409 idempotency_conflict`;
- different IDs with byte-identical visible selection fields → different deliberate SelectionItems.

## Atomic business boundary

The create writer prepares one draft SelectionItem and one durable activity outbox row, then commits:

`SelectionItem + DomainOutbox(activity) + ClientWriteRequest`

in one transaction. The former post-create `activity_service.log_event()` commit boundary is not used for creation. A losing duplicate transaction is rolled back completely; it cannot leave a second selection or activity event.

Inline outbox delivery is best-effort only after canonical commit. Durable outbox/worker processing remains authoritative.

## Transport boundary

Deterministic `400/401/403/404/409/422` remains authoritative. Only after this create became replay-safe may status `0`, `429`, ambiguous `5xx`, transport failure or a malformed committed response be durably queued with the original identity/body. Queue persistence failure is surfaced and is never reported as `offline_queued`.

## Executable evidence

- `backend/tests/test_selection_create_replay.py` — ordinary replay/conflict/equal-visible-value distinct intents and row/request/outbox cardinality.
- `backend/tests/test_selection_create_replay_postgres.py` — physical migrated-PostgreSQL same-key contention.
- `scripts/selectionTransport.test.mjs` — actual mobile `req → AsyncStorage queue → restart → flush` and failure classification.
- The PostgreSQL race is imported by a test module already selected in the dedicated migrated PostgreSQL recovery CI job; general SQLite skips are not race evidence.

## Explicitly out of scope

Selection propose/approve/reject transitions, approval → MaterialPick behavior, central #317 transport classification, #315 session generation and G04/G05 remain separate work.