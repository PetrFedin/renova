# Issue create replay contract (#417 / parent #316)

## Scope

This contract covers `POST /api/v1/projects/{project_id}/issues` and the production mobile `issuesApi.createIssue()` path. It does not claim replay safety for issue transitions/escalation/close; those remain separate mutation inventory rows.

## Business identity

- The mobile client creates `client_request_id` before the first network attempt.
- The identifier is URL-safe, 8–80 characters, and is serialized into the request body.
- The exact serialized body, including that identifier, is persisted in the offline queue after response loss, HTTP 429/5xx, or normalized transport failure (`ApiError.status === 0`).
- Deterministic HTTP 4xx responses other than 429 are authoritative and are not queued.
- Two user actions with identical visible issue fields receive different request IDs and therefore remain two independent intents.

## Server semantics

Identity scope is `(issue.create, project_id, actor_id, client_request_id)`.

- Same identity + same canonical payload returns the original `ProjectIssue` (`replayed=true`).
- Same identity + changed canonical payload returns HTTP 409 `idempotency_conflict`.
- Different identities + equal visible payload create distinct issues.
- `client_request_id` is required; the endpoint does not retain an unkeyed create path.
- Existing project-write authorization and `field_write` capability checks run before mutation.

## Atomic persistence boundary

One database transaction contains:

1. `ProjectIssue`.
2. `DomainOutbox` activity event (`IssueCreated`).
3. One `DomainOutbox` notification per customer/contractor recipient other than the actor.
4. `ClientWriteRequest` ledger row.

Outbox dispatch occurs only after commit and is best-effort. If two PostgreSQL transactions race with the same identity, the unique request-ledger constraint makes the losing transaction roll back its issue and outbox rows, then replay the canonical committed issue.

## Required evidence

- `backend/tests/test_issue_create_replay.py`: replay, payload conflict, equal-visible-values/different-intent semantics, one effect set.
- `backend/tests/test_issue_create_replay_postgres.py`: simultaneous same-key PostgreSQL race; one issue, one request ledger, one activity + recipient notification effect set.
- The PostgreSQL test is imported by the already-required migrated PostgreSQL recovery gate so a skipped generic SQLite run is never treated as race evidence.
- `scripts/issueTransport.test.mjs`: actual `req` + production issues API + AsyncStorage queue + restart flush; exact first-attempt bytes, deterministic 4xx behavior, 429/5xx/status-0 response ambiguity, persistence failure, and explicit/new intent IDs.
- The transport script is invoked from `scripts/chatBusinessCommandTransport.test.mjs`, which is already required by the mobile CI job.

## Relationship to #317

This bounded producer fix intentionally handles create-issue retry classification only after server replay safety exists. It does not close #317: central status-0/429/5xx/cancellation/storage classification and provenance still belong to the session/offline phase after parent #316 is retired.
