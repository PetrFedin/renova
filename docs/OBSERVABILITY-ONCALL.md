# Renova observability and on-call contract

Status: repository-backed production contract. External telemetry ingestion, dashboards, paging and human acknowledgement are **NOT PROVEN** until the staging drill below is completed with real infrastructure.

## What the repository now guarantees

- Sentry and OpenTelemetry are normal locked backend runtime dependencies, not optional imports.
- Production startup rejects a missing Sentry DSN, missing OTLP endpoint, localhost OTLP endpoint, insecure OTLP transport, invalid sample rates, or non-JSON logging.
- A configured Sentry/OTLP initialization failure is fatal; the API must not silently start as healthy-but-blind.
- OTel exports FastAPI traces and HTTP metrics through OTLP and attaches `service.name`, environment, Git SHA and immutable image digest resource metadata.
- Structured logs include UTC timestamp, level, logger, message, environment, service, Git SHA, image digest and request correlation ID.
- Request correlation IDs are returned to clients and attached to server spans. User identity, tokens and secrets are not added by this correlation path.
- `/health` and `/ready` expose release identity; `/ready` validates the database and the shared rate-limit backend used by production Redis policy.
- `/api/v1/admin/release-health` is the canonical operator snapshot for release identity, observability configuration truth, worker health, outbox/dead-letter state, Expo receipt reconciliation and provider configuration.
- `release-health` deliberately distinguishes configured SDKs from external ingestion. Repository state alone never sets Sentry ingestion, OTLP ingestion, structured-log ingestion or alert delivery to confirmed.

## Operational measurements

The following measurements are launch-critical. They are not product analytics.

| Area | Measurement / source | Required operational interpretation |
| --- | --- | --- |
| API | OTel FastAPI request duration, status and active-request metrics | p50/p95/p99 latency, request rate, 5xx ratio, in-flight requests by route group without high-cardinality user labels |
| API availability | `/health`, `/ready` | process liveness separately from DB/Redis-backed readiness |
| Database | `/ready` DB query plus provider DB metrics when staging provider exists | connection failures, connection-pool saturation, query latency and storage health; provider metrics are **NOT PROVEN** in repo |
| Redis | `/ready` shared rate-limiter ping plus Redis provider metrics when available | connectivity, latency, memory/evictions; managed-provider metrics are **NOT PROVEN** in repo |
| Outbox | `release-health.integrations.outbox` | `pending`, `retryable`, `poisoned`, `stale_leases`, `oldest_pending_age_seconds`; poisoned rows are dead letters |
| Expo receipts | `release-health.integrations.push_receipts` | `pending`, `due`, `terminal_errors`, `expired`, `stale_leases`, `oldest_pending_age_seconds`, `last_checked_at` |
| Automation worker | `release-health.integrations.automation_worker` | enabled/running truth, consecutive failures, outbox status and heartbeat/runtime state |
| OTP | `release-health.integrations.otp_store` | shared-store connectivity/recovery truth; repeated provider/auth failures require separate event-rate views |
| Payments | YooKassa health plus payment workflows | configuration/readiness is visible; periodic provider-state reconciliation age/backlog is **NOT YET PROVEN** and belongs to the provider-reconciliation production block |
| Email | SMTP configuration plus delivery logs | provider acceptance, bounce/reject rate and credential-expiry alerting are **NOT YET PROVEN** |
| OCR / e-sign | worker/provider runtime truth and structured failures | queue age/provider degradation must be added only where a real runtime/provider exists; do not fabricate a metric for an off integration |
| Mobile crashes | Sentry release data from a real release build | crash-free sessions/users are **NOT PROVEN** until a release build sends real events and Sentry metrics can be queried |

Do not introduce user IDs, project IDs, phone numbers, e-mail addresses, payment IDs, access tokens or raw provider payloads as metric labels. Correlation IDs are suitable for joining a specific incident trace and log stream without turning business identifiers into global telemetry dimensions.

## Launch-candidate alert policy

These are initial launch thresholds. They become launch SLOs only after the current-auth staging load suite has measured normal and failure behaviour.

| Signal | Warning | Page candidate |
| --- | --- | --- |
| readiness | one transient failure | two consecutive external readiness failures within 2 minutes |
| HTTP 5xx ratio | >1% for 10 min | >2% for 5 min |
| HTTP latency | p95 >1.0 s for 10 min | p99 >2.5 s for 10 min |
| outbox dead letters | n/a | `poisoned > 0` |
| outbox age | oldest pending >120 s for 5 min | oldest pending >300 s for 5 min |
| outbox leases | `stale_leases > 0` for 5 min | persistent stale leases plus growing backlog |
| Expo receipt reconciliation | due/stale backlog persists across two worker intervals | expired receipts increase or oldest pending approaches the 24 h retention boundary |
| automation worker | consecutive failure / unhealthy status | worker required but not running, or persistent failures with growing outbox |
| payment reconciliation | not enabled as a page until a real reconciler publishes age/backlog | threshold must be defined in provider-reconciliation block; configuration alone is not a signal |
| telemetry pipeline | one sink temporarily degraded | all external telemetry paths unavailable, once external delivery has been proven |

The next k6/SLO block must validate or change the latency/error thresholds. A threshold written in this document is not evidence that the system sustains it.

## Incident triage runbook

1. Identify the exact release using Git SHA and immutable image digest from the deployment, `/health`, `/ready` and `release-health`.
2. Check external liveness and readiness separately. A live process with failed readiness is not healthy production.
3. Open `/api/v1/admin/release-health` with an authorized administrator and inspect outbox, push receipts, workers, OTP and provider readiness without exposing secrets.
4. Use the request `X-Request-Id` / `X-Correlation-Id` to join structured logs and traces. Do not search by credentials or raw personal data.
5. Classify the fault boundary: API regression, PostgreSQL, Redis, worker/backlog, external provider, release/deployment, or telemetry pipeline.
6. If a release regression is likely, compare against the previous immutable image. Follow the deployment rollback/forward-fix procedure; never rebuild a different image from the same commit and call it a rollback.
7. For poisoned outbox events, use the existing admin dead-letter claim/recovery workflow; do not edit durable rows manually.
8. Record incident start/end, affected release/digest, user-visible impact, mitigation, recovery evidence and follow-up owner. Secrets and raw provider payloads must not enter the incident note.

## Required external staging proof

Repository CI can prove wiring and fail-closed behaviour, but it cannot prove the receiver. Before Renova is called on-call-ready, all of the following must be executed against the real external staging environment:

1. Deploy one reviewed immutable backend image and record Git SHA + registry digest.
2. Confirm `/health`, `/ready` and `release-health` report that same identity.
3. Trigger a sanitized synthetic Sentry error and verify it arrives in the intended Sentry project with staging environment and release metadata.
4. Generate a traced staging request and verify the trace and HTTP metric arrive through the configured OTLP collector/backend with service, environment, Git SHA and image digest metadata.
5. Verify structured logs arrive in the intended log backend and can be found by the same correlation ID without exposing secrets.
6. Trigger one synthetic page condition and verify the real alert reaches the named on-call owner through the real notification route.
7. Have the owner acknowledge it and follow this runbook to the exact synthetic signal.
8. Record timestamp, release SHA/digest, receiver, alert route, acknowledgement and result in production-readiness evidence. Do not commit credentials or sensitive event payloads.

Until those steps are recorded, the following remain **NOT PROVEN** regardless of green CI: Sentry external ingestion, managed OTLP collector ingestion, log-backend ingestion, dashboard availability, alert delivery, escalation routing and human on-call readiness.

## Relationship to other production gates

- DR/restore repository proof is separate from managed-provider backup/PITR proof.
- External staging verification proves release identity only when a real environment is configured; it does not prove observability receivers automatically.
- Load/SLO validation is the next engineering block after this repository observability wiring.
- Payment, e-mail, FNS/NPD, e-sign and OCR provider reconciliation/credential-expiry operations remain separate production blocks and must not be represented as complete merely because their configuration is visible in `release-health`.
