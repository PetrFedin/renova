# Renova — offline/replay mutation inventory

**Status:** P0 working inventory for #316 / #317; this document is not a claim that #316 is closed.  
**Stacked prerequisite:** PR #322 (`fix/chat-business-command-idempotency`) for chat invoice/task atomicity and shared client-write primitives.  
**Current slice:** `agent/316-direct-work-order-replay` adds direct WorkOrder create response-loss safety on top of #322.  
**Scope of this inventory:** every mobile API module currently found to persist mutations through `offlineQueue.enqueue`. Server mutations that are deliberately online-only are called out only where they delimit the contract.

## 1. Global invariants

A queued business mutation is merge-eligible only when all applicable invariants hold:

1. one user intent gets a stable identity **before the first network attempt**;
2. retry/restart sends the exact originally admitted payload and identity;
3. same identity + same canonical payload returns the original business result;
4. same identity + changed canonical payload fails closed with `409`;
5. the business graph + idempotency mapping + durable side-effect intents commit atomically;
6. post-commit delivery failure cannot turn a committed mutation into an apparent rollback;
7. deterministic 4xx is never converted into an offline/network retry;
8. physical PostgreSQL contention proves the race behavior where duplicate creation or competing writers are possible;
9. current account/session/project authority is revalidated at execution time; #315/G05 owns the cross-session generation boundary;
10. two intentionally identical user actions are **not** duplicates merely because method/path/body are byte-equal.

`OfflineJob.id` / `X-Offline-Id` is a queue transport identifier, not by itself a canonical business idempotency key.

## 2. Qualified / candidate-safe create contours

| Mobile producer | Mutation | Current identity/atomicity status | Remaining boundary |
|---|---|---|---|
| `chats.ts` / `chatCommands.ts` | chat → invoice | PR #322 candidate: stable `client_request_id`, exact-body replay, one transaction, PostgreSQL race | prerequisite must be owner-reviewed/merged |
| `chats.ts` / `chatCommands.ts` | message → task | PR #322 candidate: same client-write contract plus source-message uniqueness | prerequisite must be owner-reviewed/merged |
| `chats.ts` | send chat message | pre-existing stable `client_request_id`; backend chat message atomicity/concurrency contracts exist | #317 transport classification and #315 session isolation still apply |
| `workOrders.ts` | direct WorkOrder create | **current stacked candidate**: stable first intent, WorkOrder + bound chat + outbox + `ClientWriteRequest` one transaction; same/same replay; changed payload conflict; PostgreSQL race added to mandatory chat PG gate | this stacked PR must qualify and later rebase after #322 merges |
| `estimate.ts` | ChangeOrder create | client creates `client_request_id`; backend has `test_change_order_create_idempotency.py` | #317/session review and response-loss transport evidence still required |
| `materials.ts` | MaterialPick create | client creates `client_request_id`; backend `material_pick.create` uses canonical client-write ledger | producer/network classification still needs #317 qualification |
| `materials.ts` | Purchase create | client creates `client_request_id`; backend purchase idempotency tests exist | producer/network classification and full replay transport evidence |
| `receipts.ts` | manual / scanned Receipt create | client creates stable `client_request_id`; financial create/idempotency backend coverage exists | **#317 blocker:** current producer rethrows every `ApiError`, including normalized status `0`, before enqueue |

These rows are not interchangeable with ledger authority: a mutation can be replay-safe while its resulting financial category semantics are governed by separate finance contracts.

## 3. Queued mutations still requiring explicit replay qualification

`REQUIRES` means the mobile producer persists the mutation, but the complete response-loss contract is not proven in this inventory. Some operations may be naturally idempotent setters; that must be executable evidence, not an assumption.

| Module | Queued mutation family | Source-level observation | Verdict / next action |
|---|---|---|---|
| `chats.ts` | create chat thread | POST body has no stable business request identity | **REQUIRES idempotent create** |
| `chats.ts` | reaction | server operation is `toggle_reaction`; replay can invert the first committed intent | **P0 REQUIRES redesign to explicit set/unset or stable command identity** |
| `chats.ts` | pin/unpin message | POST carries explicit final `pin` value | prove same/same replay and post-commit response loss |
| `chats.ts` | mark read | body carries `read_through_message_id` cursor | verify monotonic/cursor replay under stale queue and account switch |
| `chats.ts` | confirm non-payment message | server sets `confirmed=True` | prove repeated request has no duplicate side effects; finance payment confirmation remains separate |
| `workOrders.ts` | PATCH WorkOrder | carries `expected_updated_at` optimistic token | conflict-safe against overwrite, but lost-response replay currently becomes stale conflict rather than transparent replay; define UX/result contract |
| `workOrders.ts` | status transition | POST carries target state only | state-machine replay behavior must be explicit; do not assume transition is idempotent |
| `stages.ts` | stage comments | create-style POST text without stable intent | **REQUIRES idempotent create** |
| `stages.ts` | stage/action/acceptance mutations | several queued POST/PATCH actions | classify each as create/set/transition and prove replay/ACL semantics |
| `estimate.ts` | add estimate line | create-style POST without stable intent | **REQUIRES idempotent create** |
| `estimate.ts` | patch estimate line | PATCH final fields, currently no version token | require stale-write/conflict policy in addition to project binding |
| `estimate.ts` | estimate lock/propose/reject/withdraw | queued state-machine POSTs | prove repeat/lost-response behavior and side-effect dedupe |
| `estimate.ts` | ChangeOrder approve/reject | queued decision POSTs | backend has atomicity/idempotency coverage in parts; qualify actual mobile response-loss path |
| `design.ts` | create design package | create-style POST; queue producer exists | **REQUIRES stable create identity** |
| `design.ts` | design decisions/updates | queued mutation family | endpoint-level replay classification required |
| `materials.ts` | submit/approve/reject MaterialPick | state transitions queued | qualify transition replay; #317 currently affects producers that rethrow every `ApiError` |
| `materials.ts` | Purchase status | target status POST | qualify repeated target-state behavior and expense side-effect dedupe |
| `materials.ts` | material-needs generation | server-side generator POST | prove repeat does not duplicate generated needs |
| `selections.ts` | selection create/propose/approve/reject/update | generic queued helper covers create + transitions | split create identity from target-state transitions; prove each |
| `issues.ts` | issue/punch mutations | shared `enqueueOffline()` wraps multiple mutations | enumerate create vs transition vs move and qualify individually |
| `floor.ts` | pin/furniture position PATCH | final coordinates are queued | parent-project ACL handled separately by #377; still needs stale/conflict/session semantics |
| `rooms.ts` | room PATCH | queued final-field update | requires stale-write/session policy; not a create-duplication problem |
| `calendar.ts` | stage calendar PATCH | queued schedule mutation | verify version/conflict behavior against canonical schedule writer |
| `misc.ts` | approval approve/reject | queued decision POSTs | qualify repeat/lost-response and decision side effects |
| `documents.ts` | document metadata/upload-related mutations | queue producer exists, but native/file bytes have separate lifecycle | replay contract must be coordinated with #320 and storage orphan semantics |
| `os.ts` | expense DELETE and OS mutations | queue producer exists | prove tombstone/idempotent delete + finance reconciliation; never infer success from local removal |
| `workSchedule.ts` | schedule create/update/status | queue producer family exists | canonical schedule version and transition replay must be proven |
| `scratchpad.ts` | scratchpad mutations | queue producer exists | endpoint-level create/update classification required |
| `receipts.ts` | receipt PATCH/DELETE | queued update/delete | qualify stale-write/tombstone behavior; create producer separately blocked by #317 |
| `payments.ts` | legacy manual-transfer confirm | queue producer exists, but catch path currently treats normalized `ApiError` specially | payment transition backend is idempotency-tested; mobile #317 transport path and exact result must be qualified |

## 4. Explicitly online-only financial/file boundaries

The inventory must not “fix offline” by silently queueing operations whose product contract intentionally requires live provider/file truth.

- Payment create currently returns `OFFLINE_PAYMENT_CREATE_BLOCKED` on transport/server ambiguity rather than queueing a new financial obligation.
- Payment evidence is a multi-step upload-intent / bytes / submit lifecycle with explicit client request IDs on intent/submit. Raw byte upload recovery is not equivalent to JSON queue replay.
- Provider checkout, disputes/refunds and external verification remain governed by their provider/reconciliation contracts; no generic offline queue should manufacture provider success.

## 5. Queue-level defect: payload-equality dedupe

Current `offlineQueue.dedupeExactJobs()` computes a signature from:

```text
userId + method + path + body
```

and removes later jobs with the same signature.

That violates the #316 business invariant: two separate user intents may intentionally be byte-identical (for example two equal-value entries or two equal comments). Business dedupe must use a stable **intent identity**, never payload equality. This function therefore remains a P0 recovery defect until replaced/retired with intent-aware behavior and an executable negative test proving two intentionally identical actions survive.

## 6. #317 transport dependency

Several producers still use the pattern:

```text
catch (error) {
  if (error instanceof ApiError) throw error;
  enqueue(...)
}
```

while the shared client normalizes transport failures into `ApiError(status=0, ...)`. For those producers the intended queue path can be unreachable. #317 owns central transport classification; #316 cannot be declared complete merely because server idempotency exists.

The target shared classification is:

- explicit cancellation → do not queue;
- deterministic 4xx → do not queue;
- transport/status 0 → queue only if the mutation itself is replay-safe;
- 429 / ambiguous 5xx / malformed committed response → queue only if replay-safe and exact identity/body are retained;
- storage persistence failure → surface failure; never report `offline_queued` without durable persistence.

## 7. Ordered retirement plan for #316

1. qualify and owner-merge #322 prerequisite;
2. qualify the stacked direct WorkOrder create slice;
3. retire chat reaction toggle replay hazard;
4. replace payload-equality queue dedupe with intent-aware semantics;
5. close remaining create-style POSTs first: chat thread, stage comment, estimate line, design package, selection/issue/scratchpad creates;
6. then qualify setter/version-fenced/state-transition rows with exact result/conflict semantics;
7. run the inventory again after #317 centralizes transport classification;
8. only close #316 when no persisted queue producer is `REQUIRES` and PostgreSQL/response-loss/session tests cover the critical business mutations.

## 8. Relationship to later gates

This inventory is a prerequisite for G04 (response loss / unstable network). It does not close G04, because G04 additionally needs the controlled runtime stack and UI recovery states. It also does not close G05; account/session generation isolation is #315 and must prevent an A→B→A stale completion or queue item from being applied under the wrong generation.