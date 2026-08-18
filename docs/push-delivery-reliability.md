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

HTTP 200 from Expo is not considered delivery success by itself. Renova validates one push ticket per submitted token. A successful ticket must contain an Expo receipt id. Permanent `DeviceNotRegistered` tokens are removed; transient/provider/payload failures return failure to the outbox so it retries.

This design intentionally does **not** claim provider-level exactly-once delivery. Stable collapse/tag identity plus client interaction deduplication reduces duplicate user-visible effects while keeping retries available for ambiguous failures.

## Operational checks

The `Push delivery retry integrity` workflow gates the focused backend ticket/retry tests, mobile dedupe behavior tests, full mobile type checking, cold-start wiring, and provider identity wiring. A regression that removes stable retry identity, cold-start response consumption, or mobile dedupe must fail CI before merge.
