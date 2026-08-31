# Renova — chat message atomicity and idempotency contract

**Status:** ACTIVE / IMPLEMENTATION IN PROGRESS  
**Parent dossier:** `docs/RENOVA-TECHNICAL-SPECIFICATION.md`  
**Governance:** `docs/technical-spec/END-TO-END-GOVERNANCE.md`

## Scope

This annex governs client-originated chat-message creation and its user-visible reconciliation. It refreshes the historical implementation lineage from PR #282 onto current `main`. The old PR is not merge evidence.

Canonical end-to-end chain:

`chat composer / operational chat action -> stable client_request_id -> thread/project authorization -> canonical request hash -> ClientWriteRequest ledger -> ChatMessage + recipient visibility + DomainOutbox notification intents in one DB transaction -> commit -> optional inline outbox acceleration + WebSocket/inbox fanout -> authoritative chat/inbox/unread reads -> mobile reconciliation/retry`.

## Canonical authorities

- write idempotency ledger: `ClientWriteRequest`, scope `chat.message.create`;
- message mutation orchestration: `backend/app/services/chat_message_mutation.py`;
- durable recipient side effects: `DomainOutbox`; direct WebSocket/inbox fanout is acceleration only;
- thread/project access: server-side chat/project ACL, never client capability inference;
- unread/read/archive truth: server read models and read cursors; clients replace/reconcile from authoritative snapshots;
- mobile retry identity: the serialized request body created before the first network attempt, including `client_request_id` and `reply_to_id`.

## Required invariants

1. One logical request identity creates at most one canonical ChatMessage.
2. Replaying the same request ID with the same canonical payload returns the canonical message without duplicating durable effects.
3. Reusing the request ID with a different canonical payload fails with conflict (`409`).
4. Concurrent same-key PostgreSQL writers collapse to one canonical ledger row/message/effect set.
5. Message creation, recipient auto-unarchive/read-state preservation, and durable notification intents commit atomically.
6. Recipient `last_read_at` is not advanced by incoming messages; sender archive state is not implicitly changed.
7. Active exact-thread participants are part of the recipient set in addition to applicable project actors.
8. WebSocket failure after commit must not roll back or falsify durable message/outbox truth.
9. Thread-only users retain valid chat actions but server capabilities must not expose project-authority dead ends.
10. Inbox/unread state is reconciled from server snapshots and must not double-increment through WS + polling + read-cursor replay.
11. Reply targets must belong to the same thread.
12. Invalid message types fail before durable mutation.

## Explicit non-scope / retained blocker

PostgreSQL transaction atomicity does not make external object storage atomic. Attachment replay is checked before storage, but a truly concurrent attachment race may leave an ambiguous/orphan object if the losing database transaction already wrote storage. This remains governed by #238 and MUST NOT be represented as solved by this chat change.

## Verification gate

The current-main successor must provide fresh exact-head evidence for:

- focused SQLite/unit atomicity and rollback contracts;
- real PostgreSQL two-session same-key concurrency;
- exact-thread participant delivery and recipient visibility;
- ACL and thread-only mobile capability contracts;
- authoritative unread/inbox reconciliation;
- mobile TypeScript/domain/runtime contracts;
- API E2E: first send -> same-key replay -> changed-payload conflict -> exactly one transcript message;
- full backend regression and current Alembic head;
- full required repository CI, including technical-spec integrity.

No old #282 green SHA, test log, or branch state is merge evidence for the successor.