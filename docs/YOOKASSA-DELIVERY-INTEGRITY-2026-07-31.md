# YooKassa delivery integrity — 2026-07-31

## Closed defects

1. **No inter-process single-winner claim.** The legacy handler checked durable completion only after the business transition. Two concurrent deliveries could therefore enter subscription or project-payment processing together.
2. **Completion identity could be missing.** A provider event without a stable object/payment ID could mutate business state without producing a durable replay key.
3. **Subscription settlement was under-validated.** The webhook did not require the exact subscription kind, amount, RUB currency, an existing non-deleted user, or contractor role before Pro activation.
4. **Project payment was split across commits.** Provider-ID attachment, payment confirmation, financial events/outbox and webhook completion were separate transaction boundaries.
5. **Stale delivery ownership was not fenced.** There was no durable owner token preventing an expired worker from completing a reclaimed event.
6. **Out-of-order provider events could be lost.** A refund arriving before the local success transition could be acknowledged permanently instead of remaining retryable.
7. **Webhook authentication had weak edges.** Secret comparison was not constant-time and production aliases did not consistently activate the IP allowlist policy.

## New delivery contract

The canonical endpoint now follows this order:

1. validate source IP policy and shared webhook secret;
2. parse JSON and validate the provider envelope;
3. derive a bounded event key from event type plus provider object ID;
4. acquire a durable owner-fenced claim;
5. prepare the business transition without internal commits;
6. atomically commit business state, payment/subscription events, outbox rows, delivery completion and the legacy-compatible `PaymentWebhookEvent` marker;
7. on retryable failure, roll back business state and persist bounded retry metadata;
8. on cancellation, release only the owned claim without consuming an attempt.

`accepted` and `business_applied` are intentionally separate response fields. A permanent evidence mismatch can be acknowledged at the transport layer while remaining explicitly recorded as `business_applied=false` with outcome `ignored:<reason>`. Transient ordering or availability failures return non-2xx and remain uncompleted.

## Durable state

Migration `w6webhookdelivery01` creates `payment_webhook_deliveries` after current head `w7codoclink001` with:

- owner token and lock timestamp;
- bounded attempts and next retry time;
- completion timestamp and outcome;
- last error evidence;
- provider and event kind.

CI includes a graph guard requiring exactly one Alembic head.

## Verified scenarios

- missing provider object ID is rejected before a database claim;
- wrong subscription kind, amount, currency or role never activates Pro;
- valid Pro activation is single-winner and replay-safe;
- a concurrent second delivery cannot run business logic;
- a stale owner cannot commit after another worker reclaims the event;
- a crash after provider-ID attachment rolls the entire project payment transition back;
- incorrect secret is rejected before claim creation;
- `prod` environment alias enables the production IP allowlist;
- out-of-order refund remains retryable, while permanent terminal conflicts remain monotonic;
- PostgreSQL applies the full Alembic chain to one head.

## Residual risks

- Provider authenticity still depends on the configured IP policy and shared secret. Production operations should additionally reconcile important settlements with the provider API when credentials and rate limits permit.
- Permanent ignored outcomes require operational alerting and a review workflow; they are durable but not yet surfaced in a dedicated payment-operations dashboard.
- Retry/poison cleanup and retention for `payment_webhook_deliveries` need an operations policy.
- External provider delivery is not exactly-once. The database transition is single-winner; provider and network delivery remain at-least-once.
- Compatibility helpers such as `record_webhook_processed` remain in the service for older callers, but the canonical HTTP endpoint no longer uses them.
