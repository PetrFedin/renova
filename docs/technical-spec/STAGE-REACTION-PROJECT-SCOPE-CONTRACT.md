# Stage reaction project-scope contract

**Status:** ACTIVE / GOVERNED SECURITY ANNEX

## Purpose

Stage-comment reactions are child-resource reads and writes. Authorization of the URL `project_id` is not sufficient unless the supplied `stage_id` and `comment_id` are proven to belong to that same authorized resource chain before any reaction is read, deleted, inserted or committed.

## Canonical binding invariant

For reaction routes under:

`/projects/{project_id}/stages/{stage_id}`

the authoritative child chain is:

`authorized Project -> Stage(project_id) -> StageComment(stage_id) -> CommentReaction(comment_id)`.

A mutation or read may proceed only after proving:

- `Stage.id == stage_id` and `Stage.project_id == project_id`; and
- for comment-specific routes, `StageComment.id == comment_id` and `StageComment.stage_id == stage_id`.

A foreign or mismatched child returns `404` before reaction state is exposed or changed.

The forbidden write sequence is:

`authorize Project A -> trust foreign comment_id -> delete/insert reaction -> commit -> discover nothing about the foreign child`.

The forbidden read sequence is:

`authorize Project A -> query reactions by foreign comment_id/stage_id -> return Project B data`.

## Routes covered

This contract applies to:

- `POST /api/v1/projects/{project_id}/stages/{stage_id}/comments/{comment_id}/react`;
- `GET /api/v1/projects/{project_id}/stages/{stage_id}/comments/{comment_id}/react`;
- `GET /api/v1/projects/{project_id}/stages/{stage_id}/reaction-counts`.

Notification side effects after a successful reaction write must use the comment that already passed the scoped lookup; an unscoped child reload after commit must not become a second authority path.

## Verification

The required stage-mutation/full-backend evidence must prove:

1. an actor authorized to Project A cannot mutate reactions of a Stage/Comment owned by Project B;
2. after the rejected write, a fresh database read shows Project B reaction truth unchanged;
3. a comment from another stage cannot be read or mutated through a valid same-project stage URL;
4. a foreign stage cannot expose aggregate reaction counts;
5. a correctly bound Project A -> Stage A -> Comment A write/read/count flow still works.

Tests are collected under `tests/test_stage_mutation_integrity*.py`, so the existing required `stage-mutation-contracts` context exercises the negative and positive binding contract without introducing a new workflow.

## Evidence boundary

This annex repairs project/stage/comment binding only. It does not change project-role authority, complete `ProjectParticipant.scope` adoption (#300/B1), or make reaction toggles replay/idempotency-safe (#316). It is source/CI security evidence only and is not a staging/production incident claim.
