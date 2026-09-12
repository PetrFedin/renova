# Renova — materials mutation outcome contract

**Статус:** ACTIVE / governed annex  
**Область:** `apps/mobile/components/screens/OsMaterialsScreen.tsx`  
**Связь:** #305 mobile interaction/state truth; audit F09

## 1. Problem boundary

Material procurement contains critical create/status mutations followed by non-authoritative sync/read/navigation work. A confirmed server commit must never be converted into the user-visible message «не изменено» merely because a later side effect or refresh failed.

The screen must distinguish:

```text
committed
queued
authoritative_refusal
unknown_needs_reconcile
```

## 2. Read truth

Materials data is scoped to the exact current `user.id + project.id` context.

- first load does not render zero summaries while data is unknown;
- overlapping reads use a generation/context fence so an older project/account response cannot overwrite a newer screen context;
- first-load failure is `error`, not empty;
- refresh failure after confirmed data is `stale`, preserving the last confirmed rows;
- while materials data is stale, procurement/receipt mutations fail closed until a successful refresh;
- read failures remain observable through `reportError`.

This is a local screen fence. It does not claim closure of the broader RenovaContext session-generation issue #315.

## 3. Purchase create

Flow:

```text
user intent
→ createPurchase
→ queued | authoritative refusal | unknown | committed Purchase
```

If queued:
- show the canonical offline queue message;
- do not present creation as server-confirmed;
- do not ask the user to create another purchase.

If authoritative 4xx refusal:
- state that the server did not confirm the change;
- 409 specifically requires refresh before another attempt.

If transport/result is ambiguous and not durably classified as queued:
- show `unknown_needs_reconcile` copy;
- do not encourage a repeated create;
- primary recovery is a read refresh/reconcile.

If `createPurchase` resolves with a Purchase:
- the commit is authoritative;
- publish the confirmed Purchase locally before best-effort reconciliation;
- navigation/read/sync failure cannot turn this into «creation failed»;
- on reconciliation debt show «Закупка создана… не все данные удалось обновить» and a refresh action, never a second create action.

## 4. Purchase status transition

The same separation applies to `updatePurchaseStatus`:

```text
status mutation confirmed
→ publish returned Purchase locally
→ syncProjectSideEffects
→ authoritative read refresh
→ normal success feedback | committed-but-refresh-failed feedback
```

The previous failure mode where one `catch` covered both the status mutation and later refresh is forbidden. The phrase `Статус не изменён` is invalid after the server has already returned the updated Purchase.

Cancellation remains destructive and retains the existing pre-confirmation. This annex does not change the backend purchase state machine or budget recognition rules.

## 5. Material-needs generation

Generation uses the same outcome model:

- queued is reported as queued;
- 4xx refusal is not success;
- ambiguous outcome requires reconcile before repeat;
- confirmed generation followed by sync/read failure is reported as committed with refresh debt.

## 6. Verification

`materialPickDetailContract.test.ts` additionally locks the screen-level invariants:

- load generation/context fence exists;
- first load has an explicit loading surface;
- stale data disables critical procurement/receipt mutations;
- queued operations use canonical offline feedback;
- purchase create/status publish confirmed entities before reconciliation;
- old false copy `Статус не изменён. Проверьте сеть и повторите.` is absent;
- ambiguous outcome copy tells the user to reconcile before repeat.

`SCREEN-SOURCE-SNAPSHOT.md` is synchronized to the exact `OsMaterialsScreen.tsx` blob.

Required merge evidence remains mobile typecheck/contracts plus the applicable full repository CI. Source/CI evidence does not prove physical-device or production behavior.

## 7. Non-goals

- no backend purchase state-machine change;
- no budget recognition change;
- no new provider activation;
- no closure claim for #315 global session fencing;
- no closure claim for #317 transport/cache provenance;
- no broad MaterialPick/Purchase redesign;
- no route or navigation architecture change.
