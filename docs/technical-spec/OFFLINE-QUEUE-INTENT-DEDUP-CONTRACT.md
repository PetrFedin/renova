# Renova — offline queue intent-dedup contract (#386)

**Status:** candidate / not merged.  
**Parent:** #316 P0 Recovery.  
**Scope:** client-side recovery cleanup only; this annex does not make an unsafe server mutation replay-safe.

## 1. Why payload equality is forbidden as identity

The historical recovery action removed later jobs when this tuple matched:

```text
userId + method + path + body
```

That is not proof of one business intent. A user can intentionally submit two byte-identical comments, estimate lines, checklist actions or other mutations. Deleting the second queue item would be client-side data loss before the server can apply its own idempotency/conflict rules.

**Invariant:** payload equality alone is never identity.

## 2. Canonical cleanup identity

The queue preserves input order and removes a record only when it can prove a repeated persisted intent.

### 2.1 Exact copied queue record

A repeated local queue record may collapse only when all persisted identity/mutation bytes match:

```text
queue id + userId + method + path + body
```

Same queue id with changed bytes is preserved fail-safe.

### 2.2 Stable business request identity

For a valid JSON object carrying a non-empty `client_request_id`, the intent boundary is:

```text
userId + method + path + client_request_id + exact body
```

Consequences:

- same key + same bytes → repeated stored intent may collapse;
- same key + changed bytes → **preserve both** so the server can surface its canonical idempotency conflict instead of the client hiding it;
- different request IDs → preserve both even when all other business fields are equal;
- different user/method/path → preserve both;
- missing, invalid or non-JSON body identity → preserve records unless they are an exact copied queue record.

This cleanup rule is deliberately stricter than server idempotency. It never invents identity from equal payload content.

## 3. Atomicity

`dedupeIntentDuplicates()` executes inside the existing `withQueueLock()` and always reads the latest canonical queue before applying `dedupeJobsByIntent()`. It must not rewrite a stale screen snapshot or race a concurrent enqueue/flush mutation.

The recovery screen calls only this locked API. UI wording explicitly states:

> Совпадающий текст сам по себе не считается дублем: отдельные одинаковые действия сохраняются.

The action is therefore presented as removing a repeated **intent**, not “equal data”.

## 4. Exact source bindings

| Source | Blob SHA | Contract |
|---|---|---|
| `apps/mobile/lib/offline/intentDedupe.ts` | `ff7be326a84023600e8fa398949b6dee28ca506a` | pure fail-safe identity and order-preserving cleanup |
| `apps/mobile/lib/offlineQueue.ts` | `02a55080286537145dddffe1768561ab4aa8b9c9` | latest-queue lock + canonical cleanup mutation |
| `apps/mobile/app/_stack/conflicts.tsx` | `162fa730d58e2a59d59761a79bd99fa6b6861a50` | recovery UI uses intent-aware action and truthful wording |
| `apps/mobile/lib/offline/intentDedupe.test.ts` | `89560389b7de32f595dde22064e2afe283931dea` | executable positive/negative identity cases |
| `apps/mobile/lib/consoleAssertFailClosed.test.ts` | `9e822d41e6a29e78df459bd46cacd825b4b2b0a4` | required mobile suite executes the new unit contract |

These bindings are candidate traceability only until the exact PR head passes required CI.

## 5. Required executable cases

1. two byte-identical jobs without `client_request_id` survive in original order;
2. same business payload with different request IDs survives;
3. same request ID + exact same body collapses to the first canonical record;
4. same request ID + changed body survives so server conflict remains visible;
5. an exact copied queue record can collapse;
6. same queue id with changed body survives fail-safe;
7. invalid/non-JSON payloads with different queue ids survive;
8. different users/methods/paths never collapse.

## 6. Boundaries

This slice does **not**:

- assign missing business intent IDs to create-style queued POSTs;
- make raw state transitions replay-safe;
- solve #317 transport classification;
- solve #315 account/session generation isolation;
- close #316 or G04/G05.

Those mutations remain in the recovery inventory until their own server + mobile + PostgreSQL/response-loss evidence is complete.
