# Renova — chat reaction replay contract (#384)

**Status:** candidate / not merged.  
**Parent:** #316 P0 Recovery.  
**Prerequisite base:** PR #322 (`fix/chat-business-command-idempotency`).  

This annex replaces the queued mobile reaction path's replay semantics without changing the visible reaction UX. It does not close #316, #317, #315, G04 or G05.

## Canonical path

```text
user tap
→ api.reactChatMessage
→ client_request_id created before first send
→ exact serialized {client_request_id, emoji}
→ POST /projects/{project}/chats/{thread}/messages/{message}/react
→ chat/thread/message ACL
→ ChatMessage SELECT ... FOR UPDATE
→ re-check ClientWriteRequest after the row lock
→ toggle once for this user intent
→ ChatMessage.meta_json + ClientWriteRequest one commit
→ websocket broadcast only as post-commit acceleration
→ response / exact offline replay
```

## Replay invariant

Identity is:

```text
scope = chat.reaction
+ project_id
+ user_id
+ client_request_id
+ canonical payload(thread_id, message_id, emoji)
```

- same key + same payload returns the current canonical reaction map and **does not toggle a second time**;
- same key + changed payload returns 409;
- a second intentional user tap receives a new request identity and therefore remains a distinct toggle;
- deterministic 4xx is not queued;
- network/status-0, 429, ambiguous 5xx or malformed-success response may queue only the exact first serialized intent;
- failed queue persistence must surface failure rather than claim `offline_queued` success.

A server-side network pre-read of reaction state is deliberately not used: it would make a new offline reaction impossible and introduce a stale-read race. Exactly-once intent identity is the replay boundary for the existing toggle UX.

## Shared JSON/concurrency invariant

Task linking and reactions share `ChatMessage.meta_json`. Reaction writes therefore lock and re-read the message row before mutation. A task-link transaction and a reaction transaction must serialize on PostgreSQL so neither field can overwrite the other.

The idempotency mapping is re-checked **after** the row lock. This is mandatory: two same-key requests may both see no mapping before contention; the waiter must observe the first committed mapping and return without a second toggle.

## Route composition

The legacy reaction handler remains in `chats.py` only as historical implementation code, but its route signature is removed during router composition. The canonical `/react` route is supplied by `chat_reaction_intents.router`, so there is one active POST writer for this path.

## Exact source bindings

| Source | Blob SHA | Contract |
|---|---|---|
| `backend/app/api/v1/router.py` | `dda6fdda08440b0612b861d0c650674918bbc924` | removes legacy reaction route and includes canonical replacement |
| `backend/app/api/v1/chat_reaction_intents.py` | `0ac0fcd84b669ff6ec681f59657664b0a561af4b` | ACL + required request identity + 409 mapping |
| `backend/app/services/chat_reaction_intent.py` | `f7becfd86948865d2ae020d39731844cb487be11` | row lock, replay check, one toggle/intent, atomic request mapping |
| `apps/mobile/lib/api/chatReactionIntents.ts` | `f6487dc30226b5233bef052024862a57c214ae15` | stable first intent + safe queue classification |
| `backend/tests/test_chat_reaction_intent.py` | `0969f1b9227fde342e4fc810a4dc8f0893dc3ac2` | same/same replay, changed payload, second intent, metadata preservation |
| `backend/tests/test_chat_business_commands_postgres.py` | `6be9debc599758403f80a5a5133fdc5941732b05` | physical task/reaction and same-key reaction row-lock contention |
| `scripts/chatBusinessCommandTransport.test.mjs` | `279645db6a285af02c7ca0bf8016f0620ad58123` | actual req → queue → restart → flush response-loss proof |

These hashes are candidate traceability only until the exact branch head passes required CI.

## Acceptance

Before merge eligibility:

1. same reaction intent replay leaves exactly one user reaction and one `ClientWriteRequest`;
2. changed emoji under the same key conflicts without a second toggle;
3. a new request key can intentionally remove the reaction;
4. unrelated `linked_task_id`, existing reactions and custom metadata survive;
5. physical PostgreSQL waiter is observed through `pg_blocking_pids` and then replays without toggling twice;
6. task-link vs reaction PostgreSQL contention preserves both JSON fields;
7. mobile lost-response/restart uses identical first bytes and identity;
8. mobile 4xx does not queue; permitted ambiguous failures do; storage failure is not reported as queued success;
9. technical-spec integrity, mobile typecheck/contracts, full backend and PostgreSQL migration are green.

## Residual #316 blockers

- payload-equality `offlineQueue.dedupeExactJobs()`;
- create-style queued POSTs without stable business intent identity;
- transition/setter replay contracts still marked `REQUIRES` in the recovery inventory;
- #317 centralized transport classification;
- #315 session-generation isolation and G04/G05 controlled-runtime evidence.
