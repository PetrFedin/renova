# Renova — Warranty atomicity and idempotency contract

**Status:** ACTIVE / PENDING EXACT-HEAD CI  
**Issue:** #266  
**Historical reference:** PR #287 only; current implementation is rebuilt from current `main`.

## Canonical E2E path

`Documents hub → authenticated mobile request → project write ACL → validated payload + stable client_request_id → ClientWriteRequest → ProjectIssue + warranty ProjectDocument → activity/notification DomainOutbox → one PostgreSQL commit → optional inline acceleration → renova-worker retry/DLQ/recovery → canonical response → list/read → customer close → closeout reconciliation`.

## Transaction invariant

One create action is one transaction containing Issue, warranty Document and initial version, ClientWriteRequest, activity outbox and opposite-party notification outbox when applicable. Pre-commit failure leaves no durable partial result. Post-commit delivery failure leaves durable outbox work for the worker.

## Idempotency invariant

Identity is `scope + project_id + user_id + client_request_id + canonical payload hash`.

- same key + same payload returns the original canonical Issue/Document;
- changed payload under the same key returns 409;
- concurrent PostgreSQL writers collapse to one result/effect set;
- timeout-after-commit and offline replay preserve request identity;
- no warranty-specific idempotency table is introduced.

## Async rollback invariant

`commit_client_write` may rollback a losing concurrent transaction. ORM Project state may then be expired. The service therefore captures scalar `project_id` and `post_closeout` before the race and reconstructs only from those scalars plus explicit fresh queries. Post-rollback ORM Project dereference is forbidden.

## Route/compatibility invariant

Exactly one POST create handler is composed. Legacy create is removed before the canonical router is included; existing GET list and POST close remain. Warranty remains allowed after closeout. Open warranty claims block closeout before archival; customer close removes that blocker and archives the linked warranty document.

## Mobile retry invariant

Mobile creates `client_request_id` before first network attempt and serializes once. Deterministic 4xx is not queued. Network/status-0 and ambiguous 5xx enqueue the exact serialized body. Offline flush replays stored body without regenerating identity.

## Required proof

First create; same-key replay; conflict; real two-session PostgreSQL race; document rollback; outbox rollback; project/user scope; mandatory identity; exact-body offline replay; single route; list/close; closeout block/unblock; post-closeout create; full backend; mobile/typecheck; Playwright; security and technical-spec gates.

This contract does not claim external storage/provider readiness. #238 remains separate.
