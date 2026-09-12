# Stage-comment replay contract — #398 / parent #316

Status: **stacked candidate on PR #322; owner merge/rebase and exact CI required**.

## Source boundary

| Source | Candidate blob | Contract |
|---|---|---|
| `backend/app/api/v1/router.py` | `16417cd4f98ca75a048e67479056dfd579f7fb8a` | exactly one production POST stage-comment writer; unsafe legacy route is removed at composition |
| `backend/app/api/v1/stage_comment_intents.py` | `6bfd25258dd7b53f714fbfd6d52eaeb25aad4605` | project write ACL + stage/project binding + 409 conflict mapping |
| `backend/app/services/stage_comment_intent.py` | `e417ca1d3250190479dee799aa0f15046781915e` | StageComment + ClientWriteRequest one transaction |
| `apps/mobile/lib/api/stagesReplay.ts` | `24f2eb7c6384212610a61bcb43d6c5f7eeb1e3f3` | production override mints stable request identity before first transport, retains exact bytes and treats 429 as replay-safe ambiguity |
| `apps/mobile/lib/api/index.ts` | `377d10820e8b798717742d52d9c349c8cdc75490` | canonical mobile API composition exports the replay-safe stage wrapper instead of direct legacy `stages.ts` composition |

`apps/mobile/lib/api/stages.ts` remains the base surface for all unchanged stage operations. Its local `addStageComment` implementation is no longer the production-composed writer; this bounded wrapper avoids broad transport-policy changes before #317.

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

## Transport classification for this bounded create

Because this create now has stable server-side replay identity, the production-composed mobile wrapper applies the following local rule until #317 centralizes transport classification:

- `400/401/403/404/409/422` → authoritative, do not queue;
- status `0`, `429`, ambiguous `5xx`, transport failure or malformed committed response → may queue the exact original body;
- storage persistence failure → surface failure, never claim `offline_queued`.

No other stage mutation inherits this rule from the wrapper.

## Required evidence

- ordinary backend replay, changed-payload conflict, equal-text/different-intent and injected pre-commit rollback tests;
- exactly one composed POST writer, owned by `stage_comment_intents`;
- physical migrated-PostgreSQL simultaneous same-key race with zero skipped qualification cases;
- actual production-composed mobile `req → ambiguous response → AsyncStorage queue → restart → flush` using the exact first body;
- deterministic 4xx is not queued; replay-safe ambiguity including 429 may be queued; persistence failure is surfaced;
- TypeScript/domain/runtime, full backend, Alembic and living-spec gates green.

## Boundaries

This slice does not change stage state transitions, acceptance, photos/media or comment reactions. It does not close #316, #317, #315, G04 or G05. Central transport classification remains #317 even though this specific producer can safely queue ambiguity after acquiring a server replay contract.