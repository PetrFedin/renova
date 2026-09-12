# Stage-comment replay contract — #398 / parent #316

Status: **stacked candidate on PR #322; owner merge/rebase and exact CI required**.

## Source boundary

| Source | Candidate blob | Contract |
|---|---|---|
| `backend/app/api/v1/router.py` | `16417cd4f98ca75a048e67479056dfd579f7fb8a` | exactly one production POST stage-comment writer; unsafe legacy route is removed at composition |
| `backend/app/api/v1/stage_comment_intents.py` | `6bfd25258dd7b53f714fbfd6d52eaeb25aad4605` | project write ACL + stage/project binding + 409 conflict mapping |
| `backend/app/services/stage_comment_intent.py` | `e417ca1d3250190479dee799aa0f15046781915e` | StageComment + ClientWriteRequest one transaction |
| `apps/mobile/lib/api/stages.ts` | `cdd20b7e171b5fb564e0b9948680525602a11a6e` | stable request identity exists before first transport and exact bytes enter queue |

## Business identity

Comment text is content, not idempotency identity.

```text
identity = actor + project + scope(stage.comment.create) + client_request_id
payload  = canonical(stage_id, text)
```

Mandatory behavior:

- same identity + same payload → original StageComment;
- same identity + changed stage/text → `409 idempotency_conflict`;
- different identity + identical text → separate user comments;
- lost response after commit → queue/restart replay returns original comment without duplication;
- durable queue write failure → no false `offline_queued` result.

## Transaction and authorization

The production route revalidates current project write authority, then verifies `Stage.project_id == project_id`. The service commits:

```text
StageComment + ClientWriteRequest
```

as one transaction. A duplicate-key loser rolls back its candidate comment and resolves the canonical committed entity id.

## Required evidence

- ordinary backend replay, changed-payload conflict, equal-text/different-intent and injected pre-commit rollback tests;
- exactly one composed POST writer, owned by `stage_comment_intents`;
- physical migrated-PostgreSQL simultaneous same-key race with zero skipped qualification cases;
- actual mobile `req → ambiguous response → AsyncStorage queue → restart → flush` using the exact first body;
- deterministic 4xx is not queued; replay-safe ambiguity may be queued; persistence failure is surfaced;
- TypeScript/domain/runtime, full backend, Alembic and living-spec gates green.

## Boundaries

This slice does not change stage state transitions, acceptance, photos/media or comment reactions. It does not close #316, #317, #315, G04 or G05. Central transport classification remains #317 even though this specific producer can safely queue ambiguity after acquiring a server replay contract.