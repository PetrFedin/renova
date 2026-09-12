# Chat-thread replay contract — #390 / parent #316

Status: **stacked candidate on PR #322; owner merge/rebase and exact CI required**.

## Source boundary

| Source | Candidate blob | Contract |
|---|---|---|
| `backend/app/api/v1/router.py` | `7240d10eab857177b17fbc69579b04e5c57d7f42` | exactly one production `POST /api/v1/projects/{project_id}/chats` writer, owned by `chat_thread_intents` |
| `backend/app/api/v1/chat_thread_intents.py` | route replacement | ACL + request schema + 409 conflict mapping |
| `backend/app/services/chat_thread_intent.py` | intent service | one ChatThread + one initial system message + ClientWriteRequest commit |
| `apps/mobile/lib/api/chats.ts` | mobile producer | stable `client_request_id` is serialized before first transport and exact bytes enter offline queue |

## Business identity

A thread title is presentation data, not an idempotency key.

```text
identity = actor + project + scope(chat.thread.create) + client_request_id
payload  = canonical(title, topic)
```

Mandatory behavior:

- same identity + same canonical payload → return original ChatThread;
- same identity + changed title/topic → `409 idempotency_conflict`;
- different identity + byte-equal title/topic → distinct user action and distinct ChatThread;
- response loss after commit → replay returns the original thread, not a title-matched guess;
- queue persistence failure → no false `offline_queued` success.

The legacy `chat_service.find_thread_by_title()` remains available to controlled seed/ensure callers. It is not production-create idempotency.

## Atomicity

Before the one client-write commit, the candidate transaction contains:

```text
ChatThread + initial system ChatMessage + ClientWriteRequest
```

Concurrent same-key candidates are fenced by the unique client-write mapping. The losing candidate transaction rolls back its candidate thread and system message and resolves the winner's canonical entity id.

## Required evidence

- SQLite/ordinary backend replay: one thread, one system message, one mapping;
- same key + changed payload conflict;
- two equal titles with different request IDs remain two threads;
- injected pre-commit failure leaves no thread/message/mapping;
- composed route count is exactly one and module is `chat_thread_intents`;
- physical migrated-PostgreSQL simultaneous same-key race converges to one business graph;
- actual mobile `req → ambiguous response → AsyncStorage queue → restart → flush` reuses the first body/identity;
- mobile two intentional equal-title creates generate different intent IDs;
- full relevant CI and technical-spec gates green.

## Boundaries

This candidate does not close #316. Chat reactions (#384/#385), direct WorkOrder (#383), intent-aware queue cleanup (#386/#387), remaining create/set/transition rows, #317 transport classification, #315 session generation and G04/G05 remain separate gates.