# Renova - atomic chat business commands

**Status:** IMPLEMENTED / EXACT-HEAD CI REQUIRED
**Parent:** `docs/RENOVA-TECHNICAL-SPECIFICATION.md`
**Tracking:** #316 (bounded slice, remains OPEN), related #317/#305; session boundary #315 remains OPEN.
**Base:** merged audit #321, `2aedef4b17b2621931a63bc9272605da60dacdcf`.
**Owner function:** backend transactions + mobile interaction engineering.

## Current owner direction: finish the core, do not activate providers

The owner explicitly deferred connecting YooKassa and other external services in this development stage. No credentials, live checkouts, real SMS, external e-sign/OCR/push delivery, production deployment or external verification is authorized by this slice. Existing provider adapters, durable request identities, outbox/worker, reconciliation and unavailable states remain the architecture for later activation. Do not replace disabled providers with fake success or remove planned functions. External readiness issues remain open/deferred, not completed; core correctness does not depend on obtaining live provider keys.

## Affected end-to-end result

`chat action -> stable client_request_id -> authenticated project/thread authority -> locked current project -> canonical payload/replay -> composed business graph + durable events -> ONE commit -> best-effort WS -> canonical reads -> explicit success/queued/refused/unknown UI`.

One invoice creates one pending Payment and one linked chat message, plus one payment notification intent, one chat notification per eligible recipient and one activity intent. It does NOT charge a card, confirm settlement, create an Expense or bypass stage acceptance. Decimal input is finite/positive, at most two decimal places, and must survive the existing float persistence representation without changing its decimal value. Payment types remain `advance|stage|material|final`.

One task creates one WorkOrder, its work-bound thread and system message, one source-chat command message, assignee/calendar-date fields, the original message's `linked_task_id`, work activity and chat notification intents. The existing scalar source link represents ONE work: a different-key command cannot overwrite it. UI offers the existing work link rather than another task action. Dates are frozen on initial submission and normalized as calendar dates, not recalculated after midnight during retry.

## Canonical ownership / no parallel engines

- Orchestration: `backend/app/services/chat_business_commands.py`.
- Idempotency: existing `ClientWriteRequest`, scopes `chat.invoice.create` and `chat.task.create`; actor + project + scope + key + canonical payload hash.
- Message preparation: extracted `chat_message_mutation.prepare_message`, using the existing recipient/unarchive/outbox functions. Ordinary message creation keeps its own `chat.message.create` contract and must pass regression.
- Work preparation: extracted `work_order_service.prepare_work_order`; existing direct `create_work_order` facade preserves its commit/dispatch behavior. Its missing direct-create idempotency remains #316, NOT fixed here.
- Payments: existing `payment_service.prepare_payment` and transactional payment-created side effects, not provider checkout.
- Legacy chat invoice/task entry points now delegate to the canonical orchestrator; explicit demo seed callers pass stable keys. No new shadow routes or schema/migration.
- No external provider/inline outbox call is performed by the command. Durable worker delivers committed events. WS is optional acceleration and cannot define business success.

## Input, replay and compatibility

Both existing public POST routes now REQUIRE `client_request_id`: 8-80 ASCII letters/digits/underscore/hyphen. The mobile producers serialize this ID before the first attempt and persist identical bytes on allowed retry. Missing keys (including old queued requests) fail 422 rather than silently becoming new operations. Backend and mobile must be deployed as a compatible release; do not blindly invent IDs for old ambiguous jobs.

Same key + same canonical payload returns the original message/domain link. Same key + changed payload returns 409 `idempotency_conflict`. Invoice keys distinguish intentional identical invoices. Task requests also preserve one-source/one-work semantics: a distinct key against an already-linked message returns 409 `chat_source_already_has_task`. A missing/corrupt replay entity is a real error, not success and not an excuse to create a replacement.

Replay rechecks CURRENT permissions. A durable ledger is not a perpetual permission grant. Thread-only invitees have no task/invoice authority. Only authorized contractor actors may invoice. Task assignees use the canonical project-executor/assignment-manager boundary; unrelated/deleted users and unauthorized customer assignment are rejected.

## Transaction/concurrency

The project row is locked and refreshed BEFORE rechecking actor authority. This bounds the initial implementation and serializes competing composed commands and canonical project assignment. The source message is locked/refreshed for a task; reaction JSON writers use the same message lock so they cannot erase `linked_task_id` with stale JSON. The existing reaction TOGGLE replay issue is NOT solved by that lock.

All required domain rows, source link, recipient auto-unarchive and outbox intents are prepared before `commit_client_write`. Failure before commit rolls everything back. Recipient read cursor/sender archive semantics remain unchanged. No network/provider call occurs while the authority lock is held. Project-level serialization is deliberate and needs capacity review before finer-grained optimization; replacing it with unproven SQLite-only concurrency is forbidden.

## Mobile/error behavior

`api/chatCommands.ts` is scoped to these server-idempotent commands only. It queues normalized status 0, 429, 5xx and malformed-success-body ambiguity with the exact original body. Explicit cancellation and definitive 4xx are not automatically queued. Queue persistence must succeed before showing queued; storage failure is not fake success.

The shared `req` catch now preserves its own ApiError status before lexical network detection, preventing `validation_failed` server refusals from becoming status 0. This small correction does not solve the separate ordinary-message/receipt enqueue and stale-cache provenance work in #317.

Task form and quick invoice use synchronous busy guards. Uncertain retries retain the original ID/parameters. Task due date is frozen; changing it under the same ID is not allowed. Mutation success is separated from subsequent data refresh; delivery remains pending until worker/provider evidence exists. Local mounted/context guards do not claim to fix the global account/session/queue fence #315.

## Verification required for this candidate

- `backend/tests/test_chat_business_commands.py`: actual API/service replay, new-session response-loss retry, changed-payload conflicts, intentional duplicate invoices, one source link, rollback at message/commit boundary, postcommit failure, current authority, thread-only/assignee negatives, money/date/key validation.
- `backend/tests/test_chat_business_commands_postgres.py`: current Alembic schema; two concurrent sessions with observed `pg_blocking_pids`, same-key collapse, different-payload conflict, two-key source contention, stale ownership after lock wait and task/reaction JSON preservation. A skipped race is not evidence.
- `scripts/chatBusinessCommandTransport.test.mjs`: actual TypeScript req/producer/storage/queue/flush; only network/storage/platform effects simulated. Response-loss + fresh module context, exact bytes/key, 4xx including `validation_failed`, 429/5xx, malformed reply, unavailable storage, normal success and cancellation classification.
- `e2e/chat-business-command.spec.ts`: isolated local/test users -> new project -> assignment -> source message -> task and invoice -> replay/conflict -> canonical work/payment/chat reads. No real provider or production auth assertion.
- Full backend, ordinary chat atomicity, mobile domain/runtime/typecheck, local double-seed, PostgreSQL schema, Playwright, security/spec/readiness on exact final candidate.

Local syntax/transpiled-transport checks are supplemental and use noncanonical runtime versions. Locked GitHub CI remains authoritative. Source inspection or test existence is not a successful run. No native-device test or external staging/provider validation is claimed.

## Residual scope remains OPEN

#316: direct WorkOrder creation; thread/comment/reaction/other queued business-action inventory; whole-app crash-before-enqueue and ambiguous old-client migration. #315: global session/token/cache/queue ownership. #317: ordinary chat/receipt enqueue and per-resource cache provenance. #305: complete role/device/recovery UX. #238: external/storage ambiguity. #300: independent-contractor domain adoption. No automatic issue closure or broad-production readiness promotion is justified by this slice.
