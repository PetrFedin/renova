# Renova — chat message atomicity and idempotency contract

**Status:** ACTIVE / QUALIFICATION REQUIRED  
**Parent dossier:** `docs/RENOVA-TECHNICAL-SPECIFICATION.md`  
**Governance:** `docs/technical-spec/END-TO-END-GOVERNANCE.md`

## Scope and end-to-end chain

This annex governs client-originated chat-message creation and user-visible reconciliation. Historical PR #282 is implementation lineage only; current-main successor evidence is authoritative.

`composer / operational chat -> stable client_request_id -> server ACL -> canonical payload hash -> ClientWriteRequest -> one DB transaction for ChatMessage + recipient visibility + DomainOutbox intents -> commit -> best-effort inline outbox/WS acceleration -> authoritative chat/inbox/unread reads -> cursor-bound read reconciliation -> retry with identical serialized request`.

## Canonical authorities

- idempotency: `ClientWriteRequest`, scope `chat.message.create`;
- mutation orchestration: `backend/app/services/chat_message_mutation.py`;
- durable recipient side effects: `DomainOutbox`; WebSocket is acceleration only;
- access/capabilities: server chat/project ACL;
- unread/read/archive: server read models and cursor state;
- retry identity: serialized mobile request body created before first transport attempt.

## Required invariants

1. Same request ID + same canonical payload returns one canonical message and one logical durable effect set.
2. Same request ID + different payload fails `409 idempotency_conflict`.
3. Concurrent PostgreSQL same-key writers collapse to one ledger/message/effect set.
4. Message, recipient auto-unarchive and durable notification intents commit atomically.
5. Incoming delivery never advances recipient `last_read_at` and never changes sender archive state.
6. Active exact-thread participants join applicable project actors in the recipient set; pending/deleted identities do not.
7. WS failure after commit cannot falsify or roll back durable truth.
8. Thread-only users keep valid chat actions while project-authority controls fail closed from server capabilities.
9. Inbox/unread replaces state from authoritative snapshots; WS, polling and repeated read edges do not accumulate counters locally.
10. Reply targets must belong to the same thread; invalid message types fail before durable mutation.
11. A concurrent idempotency loser resolves the winner only from scalar IDs captured before rollback; expired ORM objects must not trigger implicit async database I/O.
12. Async chat read paths must not rely on relationship lazy-loading. The chat ACL boundary eagerly materializes thread messages before API/PDF serialization.

## Qualification findings fixed on the successor

Fresh exact-head qualification exposed two real `MissingGreenlet` defects and one stale supervision contract. These are governed defects, not CI noise:

- PostgreSQL same-key race: the losing transaction rolled back and expired `ChatThread`, then replay resolution accessed `thread.id`; the mutation service now captures immutable `thread_id`/`project_id` before the race boundary.
- API transcript read: `GET /chats/{thread_id}` and PDF serialization could touch lazy `thread.messages`; `require_chat_access` now eager-loads messages at the authorized object boundary.
- technical-supervision regression still constructed `MessageCreate` without `client_request_id` and asserted the pre-outbox notification path; the test is aligned to the mandatory request identity and durable outbox delivery contract without weakening production validation.

These fixes must receive fresh exact-head PostgreSQL, technical-supervision, Playwright, backend and mobile evidence before merge.

## Retained external-storage blocker

Database atomicity does not make object storage atomic. Replay is checked before attachment storage, but a truly concurrent losing attachment request can still leave an ambiguous/orphan object. #238 remains the authority for storage/provider ambiguity and recovery; this change MUST NOT claim that problem solved.

## Verification gate

Fresh exact-head successor evidence must cover focused atomicity/rollback tests, real PostgreSQL two-session concurrency, participant delivery, ACL/thread-only capability contracts, unread/inbox reconciliation, mobile type/domain/runtime tests, API E2E first-send/replay/conflict/single-transcript behavior, full backend + current Alembic head, Playwright and technical-spec integrity. Old #282 CI is not merge evidence.