# Push delivery reliability

Renova treats in-app notifications as durable application state and Expo push as an external **at-least-once** delivery boundary. The outbox lease prevents concurrent workers from processing the same row, but it cannot make a provider request exactly-once when a process exits after Expo accepts the request and before Renova commits `SideEffectDelivery.delivered_at`.

## Stable delivery identity

Every push created from durable notification state receives an opaque `delivery_id` derived from that state:

- outbox notifications derive it from the outbox row id;
- direct notifications derive it from the persisted notification id;
- the raw durable id is hashed before it becomes the provider/client delivery identity.

The same `delivery_id` is reused on retry and is sent in three places:

- push `data.delivery_id` for client interaction deduplication;
- Expo `collapseId` so compatible provider/device queues can replace an older pending notification;
- Android `tag` so a later notification with the same delivery identity replaces the earlier displayed notification where supported.

Legacy `data.outbox_id` remains present for compatibility and can also be consumed as a fallback delivery identity by older/newer mixed clients.

## Mobile interaction semantics

The native client keeps a bounded seven-day history of handled delivery identities in AsyncStorage. Listener and cold-start notification responses share one serialized runner, so simultaneous delivery of the same response can navigate only once in one JS runtime.

The history is recorded only after navigation succeeds. A navigation failure therefore remains retryable. Storage read/write failures fail open: opening a notification is more important than suppressing a possible duplicate during a local storage outage. Corrupt stored history is treated as empty and repaired after the next successful navigation.

A notification without `delivery_id` or `outbox_id` preserves legacy behavior and is never rejected by the dedupe layer.

## Cold start

The interaction installer registers the live response listener, then checks Expo's last notification response. A successful cold-start navigation clears that response. If navigation fails, the response is left intact so a later startup can retry it. If clearing fails after navigation, the persisted delivery identity suppresses a second navigation on the next startup.

## Provider success and retries

HTTP 200 from Expo is not considered delivery success by itself. Renova validates one push ticket per submitted token. A successful ticket must contain an Expo receipt id. Permanent `DeviceNotRegistered` ticket errors are removed immediately; transient/provider/payload ticket failures return failure to the outbox so it retries.

A successful ticket is also written to `expo_push_receipts` before the sending side effect may be committed as delivered. The receipt ledger stores the Expo receipt id, the durable delivery identity, a nullable push-token row reference, and a SHA-256 token fingerprint. It deliberately does **not** copy the raw Expo token.

## Durable receipt reconciliation

The receipt worker starts from the normal FastAPI lifespan and is safe to run on every API replica. A due receipt is claimed with a short lease carrying a unique fencing token. The database transaction is committed before the network call to Expo, so a slow provider request never holds a PostgreSQL row lock. Finalization, retry release, and token cleanup all require the current fencing token; after lease expiry a stale worker can no longer overwrite a newer claim.

Receipt states are explicit:

- `pending` — ticket persisted, waiting for provider receipt or retry;
- `reconciled` — Expo reports successful handoff to APNs/FCM;
- `error` — Expo reports a terminal provider/device error;
- `expired` — the receipt aged beyond the bounded provider retention window without a terminal answer.

Missing receipts remain `pending` and are retried without consuming a provider-failure attempt. Transport, HTTP and request-level failures remain pending with bounded exponential backoff. The worker never submits more than 1000 receipt IDs in one provider request.

A delayed `DeviceNotRegistered` receipt deletes a token only when the current `push_tokens` row still has the fingerprint captured when the ticket was created. This prevents a late receipt for an old token value from deleting a replacement token that reused the same database row id.

Receipt `reconciled` is intentionally **not** described as end-user delivery or display. It records successful provider handoff only; the mobile delivery identity/deduplication layer remains responsible for duplicate interaction safety.

## Operations

`/admin/release-health` exposes a token-free `push_receipts` snapshot with pending/due/reconciled/terminal/expired counts, active and stale leases, oldest pending age, last check time, worker enablement and the hard batch limit. Terminal errors remain durable for operator investigation instead of disappearing into worker logs.

The dedicated `Push receipt reconciliation integrity` workflow verifies provider response handling, persistence, lease fencing, stale recovery, retry/expiry behavior, token fingerprint safety, PostgreSQL cross-replica claiming, and an Alembic upgrade → downgrade → upgrade cycle. The existing `Push delivery retry integrity` workflow continues to gate the client/provider delivery identity and mobile navigation semantics.

This design intentionally does **not** claim provider-level exactly-once delivery. Stable collapse/tag identity plus client interaction deduplication reduces duplicate user-visible effects while keeping retries available for ambiguous failures.
