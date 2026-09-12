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

## Concurrency boundary

Before a candidate `ProjectIssue` or outbox row is materialized, the service acquires a PostgreSQL row lock on the owning `Project` and then re-checks the request ledger while holding that lock. Concurrent issue creates for the same project therefore serialize at the boundary before mutation:

1. the first transaction acquires the project lock, checks the ledger, persists the issue/effects/ledger, and commits;
2. the second transaction then acquires the lock and performs a fresh ledger lookup;
3. for the same identity and canonical payload it returns the first committed issue without creating a second candidate issue or effect set;
4. for the same identity with a different canonical payload it fails with `idempotency_conflict`.

The unique `ClientWriteRequest` constraint remains a database backstop; it is not treated as the only concurrency barrier.

## Atomic persistence boundary

One database transaction contains:

1. `ProjectIssue`.
2. `DomainOutbox` activity event (`IssueCreated`).
3. One `DomainOutbox` notification per customer/contractor recipient other than the actor.
4. `ClientWriteRequest` ledger row.

Outbox dispatch occurs only after commit and is best-effort. A process/network failure before commit leaves none of the four business facts committed. A lost response after commit is recovered by replaying the same business request identity.

## Required evidence

- `backend/tests/test_issue_create_replay.py`: replay, payload conflict, equal-visible-values/different-intent semantics, one effect set.
- `backend/tests/test_issue_create_replay_postgres.py`: two physical PostgreSQL sessions reach the project-lock boundary concurrently; after release they must collapse to one issue, one request ledger row, and one activity + recipient-notification effect set, with one creator and one replay result.
- The PostgreSQL test is imported by the already-required migrated PostgreSQL recovery gate so a skipped generic SQLite run is never treated as race evidence.
- `scripts/issueTransport.test.mjs`: actual `req` + production issues API + AsyncStorage queue + restart flush; exact first-attempt bytes, deterministic 4xx behavior, 429/5xx/status-0 response ambiguity, persistence failure, and explicit/new intent IDs.
- The transport script is invoked from `scripts/chatBusinessCommandTransport.test.mjs`, which is already required by the mobile CI job.

## Relationship to #317

This bounded producer fix intentionally handles create-issue retry classification only after server replay safety exists. It does not close #317: central status-0/429/5xx/cancellation/storage classification and provenance still belong to the session/offline phase after parent #316 is retired.
