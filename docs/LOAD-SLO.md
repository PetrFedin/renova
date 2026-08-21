# Renova load and SLO gate

## Truth boundary

Renova capacity and launch SLO compliance are **NOT PROVEN** by pull-request CI, JavaScript syntax checks, a localhost process, or green unit tests.

A capacity claim is valid only after the production-auth suite in this document runs against the **real external staging** environment using the exact immutable backend Git SHA and image digest that are candidates for promotion, with production-like PostgreSQL/Redis/worker topology and operational telemetry available during the run.

The repository contract exists to make that proof reproducible and to prevent a regression to demo authentication, health-endpoint-only benchmarks, or a single hidden API replica being presented as a production-like topology.

## Reproducible k6 runtime

The k6 runtime is pinned in `load/K6_IMAGE` to one immutable image reference. Do not replace it with `latest` or an unqualified tag. A version change must be reviewed together with this gate and its source-contract tests.

## Authentication and fixtures

Load scenarios do not log in through `/auth/demo`, do not use `X-User-Id`, and do not send an OTP/SMS request per virtual user. They receive a pool of already provisioned staging identities through `RENOVA_LOAD_TOKEN_POOL`.

Example read-only fixture shape:

```json
[
  {"token":"<bearer-token>","project_id":"<project-id>"},
  {"token":"<bearer-token>","project_id":"<project-id>"}
]
```

The staging secret must contain multiple dedicated identities so normal per-user rate limiting is exercised without turning one account into an artificial bottleneck.

`API_BASE_URL` must use HTTPS for the external staging gate. `ALLOW_INSECURE_LOCAL=true` exists only for explicit local integrity work and is never supplied by the protected staging workflow.

## Scenarios

The protected workflow supports six explicit scenarios:

- `k6-smoke.js` — short authenticated release sanity check;
- `k6-load.js` — progressive expected-load run;
- `k6-spike.js` — abrupt concurrency increase and recovery;
- `k6-soak.js` — sustained load intended to expose resource leaks, queue growth, and retry accumulation;
- `k6-websocket.js` — production-auth WebSocket delivery through `POST /auth/ws-ticket`, a real project chat connection, a real authenticated chat write and Redis-backed multi-replica fan-out;
- `k6-webhook-burst.js` — staging-only authenticated YooKassa webhook-ingestion burst using the real webhook secret and durable claim/idempotency ledger. It sends an unsupported `load.capacity_probe` event kind so the payment/subscription business state is not mutated.

`k6-journey.js` remains the canonical intermediate ramp profile. Legacy `k6-full.js` and `k6-full-journey.js` are compatibility wrappers around the canonical scenarios, not separate auth contracts.

The read path covers the existing project list, project detail, dashboard, and project chat list. URL metric tags are normalized so project IDs do not create high-cardinality metrics.

### WebSocket evidence

The WebSocket scenario never puts the long-lived bearer token in the WebSocket URL. Each VU first obtains the existing short-lived purpose-limited ticket from `POST /api/v1/auth/ws-ticket`. It then opens `/ws/chats/{thread_id}?ticket=...`, posts a marker message through the normal chat API, and passes only when the exact marker is received over the WebSocket.

This exercises the actual HTTP → PostgreSQL → notification/chat service → Redis bridge → WebSocket path. `LOAD_ENABLE_WRITES=true` is mandatory and all fixtures must point to dedicated load-only projects/chats.

### Webhook burst evidence

The webhook burst is allowed only against HTTPS external staging and requires `secrets.STAGING_YOOKASSA_WEBHOOK_SECRET`. It does not add a benchmark-only bypass. Every request passes the production staging secret check and the existing durable webhook claim/completion path.

Event IDs are bounded to 5,000 slots per run. Reuse of completed slots also exercises durable duplicate handling while preventing an unbounded staging ledger from one test execution. The run must never report `business_applied=true` for these probe events.

This scenario proves ingestion/claim capacity only. It does not simulate provider API availability and does not replace the provider reconciliation/degraded-mode work tracked separately in #238.

## Bounded write mode

Writes are disabled by default. Setting `LOAD_ENABLE_WRITES=true` requires every fixture to include both a dedicated `project_id` and `chat_thread_id`:

```json
[
  {
    "token":"<bearer-token>",
    "project_id":"<load-only-project>",
    "chat_thread_id":"<load-only-chat>"
  }
]
```

Writes use the existing authenticated project chat endpoint. They are bounded by `LOAD_WRITE_EVERY` and `LOAD_MAX_WRITES_PER_VU`; no benchmark-only product endpoint or authorization bypass is introduced. Dedicated fixtures must be isolated from real customer projects and cleaned/reconciled as part of staging operations.

## Launch-candidate thresholds

These values are **candidate thresholds**, not proof of a committed production SLO.

HTTP/k6 thresholds:

- HTTP request failure rate: `< 1%`;
- p95 HTTP request duration: `< 1,000 ms`;
- p99 HTTP request duration: `< 2,500 ms`;
- k6 checks: `> 99%`;
- Renova journey failure rate: `< 1%`;
- WebSocket connect failure rate: `< 1%`;
- WebSocket end-to-end delivery failure rate: `< 1%`;
- WebSocket marker delivery p95: `< 1,000 ms`, p99: `< 2,500 ms`;
- webhook ingestion failure rate: `< 1%` with the same HTTP p95/p99 candidate limits.

Runtime-capacity thresholds sampled throughout the run:

- shared API registry: at least `2` live anonymized API `instance_id` values in every valid sample;
- every live API replica must match the exact candidate Git SHA **and** image digest; mixed old/new API rollout state fails the run;
- maximum SQLAlchemy pool utilization for any exact API process: `< 90%`;
- internal `SELECT 1` database probe p95: `< 250 ms`;
- Redis `PING` probe p95: `< 100 ms` and Redis available in every valid sample;
- worker pool: healthy, at least one exact worker, and every live worker must match the candidate SHA/image digest during the capacity run;
- outbox: no poisoned events, no stale leases, oldest pending age `<= 300 s`.

Push receipt pending age is retained in evidence but is not given the same 300-second threshold because Expo receipts intentionally have a provider delay before reconciliation. Stale push-receipt leases still fail the capacity gate.

Renova does **not** claim Redis utilization percentage, provider CPU/memory saturation or cloud node utilization from application data when those signals are not available. Those values must come from the managed infrastructure/observability platform if the operator wants to add them to a launch report.

These limits must be calibrated from real staging and pilot measurements before being promoted to contractual SLOs.

## Shared API capacity registry

Every API process with Redis configured publishes a short-lived, secret-free heartbeat into the shared API heartbeat registry in Redis. The heartbeat contains only:

- anonymized `instance_id`;
- release Git SHA and immutable image digest;
- timestamps;
- that process's SQLAlchemy pool configuration and current pressure.

Heartbeats refresh every five seconds and expire after twenty seconds. Shutdown removes the key explicitly. Staging and production already require Redis; an API process must publish its first shared heartbeat before it starts serving. Local/test remains tolerant of an optional unavailable Redis configuration.

`/api/v1/admin/release-health` aggregates the registry, so API replica count and pool pressure do not depend on which replica the load balancer happens to route the sampler to. This specifically prevents sticky load-balancer behavior from making one responding process look like the whole deployment.

The shared registry is operational telemetry only. It does not move business work into the API and does not undo the `renova-api` / `renova-worker` runtime split.

## Runtime capacity sampling

`scripts/external-capacity-sampler.py` calls the protected `/api/v1/admin/release-health` endpoint every five seconds while k6 is running. It writes only sanitized fields to `capacity-samples.ndjson`:

- exact release SHA and image digest;
- the shared API registry with exact-artifact counts and per-API SQLAlchemy pool state;
- the responding API process's local pool as diagnostic context only;
- database probe latency/availability;
- Redis probe latency/availability;
- shared worker-pool health/release match;
- outbox pending/retryable/poison/stale/oldest age;
- push receipt pending/due/stale information.

The sampler does not persist bearer tokens, database URLs, Redis URLs, hostnames, process IDs, exception messages, provider secrets or raw release-health payloads.

`scripts/external-capacity-evaluate.py` evaluates all retained samples after the scenario. If telemetry disappears during load, the release identity changes, fewer than two exact API instances are present, any live API/worker belongs to another release artifact, a pool value is missing, the worker pool becomes unhealthy, or a candidate limit is crossed, the capacity step fails. A missing signal is incomplete evidence, not a pass.

## Protected external staging execution

`.github/workflows/load-slo-integrity.yml` has a manual `workflow_dispatch` job bound to the GitHub `staging` environment. It requires:

- `vars.STAGING_API_BASE_URL`;
- `secrets.STAGING_ADMIN_BEARER_TOKEN`;
- `secrets.STAGING_LOAD_TOKEN_POOL`;
- `secrets.STAGING_YOOKASSA_WEBHOOK_SECRET` for the webhook-burst scenario;
- exact `release_sha` input;
- exact `image_digest` input;
- selected scenario;
- optional explicit bounded-write flag, mandatory for the WebSocket scenario.

Before load starts, the workflow reuses `scripts/external-staging-release-smoke.sh`. That gate proves the URL currently serving traffic reports the expected Git SHA and image digest through health/readiness and protected release checks. This prevents a load report from being accidentally attached to a different deployment.

During the run the capacity sampler executes in parallel. After k6 stops, the workflow stops the sampler, evaluates capacity, reconciles queues, records a sanitized run manifest and uploads the whole evidence directory even when one gate failed.

## Post-load reconciliation

A green HTTP graph is not enough. After k6 completes, `scripts/external-load-reconciliation.sh` fetches protected release health again and fails the gate when:

- the release SHA or image digest changed;
- poisoned outbox events are present;
- stale outbox leases are present;
- the oldest pending outbox item is older than 300 seconds.

The retained artifact contains the sanitized k6 summary, exact release identity, scenario, immutable k6 image, whether bounded writes were enabled, capacity samples/evaluation and post-load reconciliation. Bearer tokens and provider secrets are never written to the evidence artifact.

## Operational interpretation

A pass requires all three layers to pass together:

1. k6 scenario thresholds;
2. runtime capacity evaluation;
3. post-load queue reconciliation.

A run that meets HTTP thresholds while queues grow without recovery is a failed capacity result. A run with missing DB/Redis/worker telemetry is incomplete evidence. A shared API registry with fewer than two exact-artifact replicas is not production-like two-replica proof. A mixed release during the test is also a failure, not something to average away.

Real external Sentry/OTLP/log ingestion, cloud CPU/memory metrics, provider API degradation/reconciliation, paging delivery and human acknowledgement remain separate production proofs. This load gate does not fabricate them.

## Promotion rule

Do not state that Renova “supports N users” from scenario VU counts alone. Record the exact topology, fixture count, scenario, release identity, thresholds, queue state, observed API instances, resource pressure and any degraded providers.

Capacity/SLO becomes **PROVEN for that tested staging topology only** when the manual external staging run succeeds, all evidence files are retained, and every live API/worker used in the run belongs to the exact release artifact that is the promotion candidate. Pull-request CI proves the gate exists and is internally consistent; it does not prove real-world capacity.
