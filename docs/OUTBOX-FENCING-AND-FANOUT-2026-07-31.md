# Outbox fencing and acceptance fan-out — 2026-07-31

## Confirmed defects

1. **Lease completion was not owner-fenced.** A worker could claim an event, exceed the lease TTL, and later call success/failure after another worker had reclaimed it. The old release functions did not check `locked_by`, so the stale worker could overwrite the newer attempt.

2. **Cancellation stranded a committed lease until TTL.** `asyncio.CancelledError` bypassed the ordinary exception branch. Shutdown did not lose the event, but delayed it for the full lease window.

3. **Acceptance outbox was a non-idempotent aggregate handler.** One `acceptance.side_effects` event called multiple activity and notification services directly. A crash after any intermediate commit caused the parent retry to recreate earlier effects and resend pushes.

4. **Poison/backlog state was not present in the operational health response.** `MAX_ATTEMPTS` existed, but operators could not see pending, poisoned, stale-leased, or oldest-event metrics.

## New invariants

- Every claim receives a unique token derived from the worker identity and a random suffix.
- Success, failure, and cancellation release only when the exact token still owns the lease.
- A stale worker cannot increment attempts, clear a current lease, overwrite `last_error`, or mark the event processed.
- Cancellation releases the owned lease immediately without consuming an attempt.
- A processed event found from a stale candidate list is released as a no-op and does not increment attempts.
- `acceptance.side_effects` only expands into deterministic child outbox events.
- Every child event has a UUIDv5 derived from `parent_outbox_id + effect_key`; replaying the parent reuses the same children.
- Activity and notification leaf events use the existing `SideEffectDelivery` idempotency ledger.
- Dispatch refreshes candidates within the same bounded call, so newly expanded children can be delivered without waiting for the next worker tick.
- `/api/v1/admin/release-health` exposes bounded outbox metrics without event payloads.

## Tests

`test_outbox_fencing_integrity.py` covers:

- stale owner versus reclaimed lease;
- cancellation during handler execution;
- complete acceptance parent replay with stable activity/notification/push counts;
- poison and stale-lease observability.

The pre-existing financial outbox suite remains mandatory and verifies push failure recovery, activity/notification deduplication, retry delay, and unknown-event failure state.

## Delivery semantics and residual risk

Database entities are idempotent per leaf outbox event. External push delivery remains at-least-once: a process can theoretically stop after the provider accepts a push but before `delivered_at` commits. The outbox ID is included in the push payload and should be used as the provider/client deduplication key where supported.

Lease fencing prevents stale completion but does not terminate a stale handler. Durable handlers must therefore remain idempotent, and new multi-effect handlers must fan out into deterministic leaf events rather than commit several effects directly.
