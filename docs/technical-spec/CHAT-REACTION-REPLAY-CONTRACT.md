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

Any exception before the canonical commit must roll the session back. A failure after the reaction UPDATE has reached SQL but before the request ledger/business commit must leave neither the reaction nor a request mapping persisted, and the exact same intent must remain safe to retry once.

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

## Fail-closed qualification wiring

A green aggregate chat job is not reaction evidence by itself.

The mandatory chat qualification job must:

1. explicitly list `test_chat_reaction_intent.py`, `test_chat_reaction_route_composition.py` and the migrated PostgreSQL chat command file;
2. reject every skip/failure/error in its JUnit;
3. require by exact testcase name the replay, changed-payload, deliberate-second-intent, metadata-preservation, post-SQL-flush rollback/retry and route-composition behavioral cases;
4. require by exact testcase name both PostgreSQL reaction cases: task-link/reaction shared-JSON contention and same-key reaction replay contention;
5. invoke the production mobile `chatBusinessCommandTransport.test.mjs` directly;
6. make that harness fail unless all 15 mandatory reaction transport/retry scenarios execute, including distinct request IDs for two equal-visible intentional taps.

Removing the reaction scenarios while leaving invoice/task tests green must therefore make qualification fail.

## Exact source bindings

| Source | Blob SHA | Contract |
|---|---|---|
| `backend/app/api/v1/router.py` | `dda6fdda08440b0612b861d0c650674918bbc924` | removes legacy reaction route and includes canonical replacement |
| `backend/app/api/v1/chat_reaction_intents.py` | `0ac0fcd84b669ff6ec681f59657664b0a561af4b` | ACL + required request identity + 409 mapping |
| `backend/app/services/chat_reaction_intent.py` | `592f9cc011b716f2b3ea4569df1fa81764519ad5` | row lock, replay check, one toggle/intent, explicit pre-commit rollback |
| `apps/mobile/lib/api/chatReactionIntents.ts` | `f6487dc30226b5233bef052024862a57c214ae15` | stable first intent + safe queue classification |
| `backend/tests/test_chat_reaction_intent.py` | `559103846045bea074edca8dbec2727d7409a54b` | replay/conflict/distinct intent/metadata + post-SQL-flush rollback/retry |
| `backend/tests/test_chat_business_commands_postgres.py` | `6be9debc599758403f80a5a5133fdc5941732b05` | physical task/reaction and same-key reaction row-lock contention |
| `backend/tests/test_chat_reaction_route_composition.py` | `395a496a39ed18460699e23b4b1b61e942edf0d8` | exactly one active replay-safe POST writer |
| `scripts/chatBusinessCommandTransport.test.mjs` | `23c22325fe9431b7a691277e74a5b5b55b83514a` | direct req → queue → restart → flush + 15-scenario reaction fail-closed proof |
| `.github/workflows/ci.yml` | `49f889b064fd3d1914191d1f823f61ac11e8c9ef` | explicit reaction inputs and exact-name JUnit qualification |

These hashes are candidate traceability only until the exact branch/qualification head passes required CI.

## Acceptance

Before merge eligibility:

1. same reaction intent replay leaves exactly one user reaction and one `ClientWriteRequest`;
2. changed emoji under the same key conflicts without a second toggle;
3. a new request key can intentionally remove the reaction;
4. unrelated `linked_task_id`, existing reactions and custom metadata survive;
5. a failure after the reaction UPDATE is flushed but before commit rolls the reaction back and the same intent then retries successfully exactly once;
6. physical PostgreSQL waiter is observed through `pg_blocking_pids` and then replays without toggling twice;
7. task-link vs reaction PostgreSQL contention preserves both JSON fields;
8. mobile lost-response/restart uses identical first bytes and identity;
9. mobile 4xx does not queue; permitted ambiguous failures do; storage failure is not reported as queued success;
10. two separate equal-visible mobile taps mint different request identities;
11. JUnit exact-name guards and the mobile reaction scenario counter make omission of the required reaction proof a hard CI failure;
12. technical-spec integrity, mobile typecheck/contracts, full backend and PostgreSQL migration are green on a directly comparable qualification context.

## Residual #316 blockers

- payload-equality `offlineQueue.dedupeExactJobs()` until #387 is requalified;
- create-style queued POSTs without stable business intent identity or comparable proof;
- transition/setter replay contracts still marked `REQUIRES` in the recovery inventory;
- #317 centralized transport classification;
- #315 session-generation isolation and G04/G05 controlled-runtime evidence.
