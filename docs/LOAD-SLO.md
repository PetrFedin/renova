# Renova load and SLO gate

## Truth boundary

Renova capacity and launch SLO compliance are **NOT PROVEN** by pull-request CI, JavaScript syntax checks, a localhost process, or green unit tests.

A capacity claim is valid only after the production-auth suite in this document runs against the **real external staging** environment using the exact immutable backend Git SHA and image digest that are candidates for promotion, with production-like PostgreSQL/Redis/worker topology and operational telemetry available during the run.

The repository contract exists to make that proof reproducible and to prevent a regression to demo authentication or health-endpoint-only benchmarks.

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

All scenarios execute the same authenticated Renova journey and the same candidate thresholds:

- `k6-smoke.js` — short authenticated release sanity check;
- `k6-load.js` — progressive expected-load run;
- `k6-spike.js` — abrupt concurrency increase and recovery;
- `k6-soak.js` — sustained load intended to expose resource leaks, queue growth, and retry accumulation.

`k6-journey.js` remains the canonical intermediate ramp profile. Legacy `k6-full.js` and `k6-full-journey.js` are compatibility wrappers around the canonical scenarios, not separate auth contracts.

The read path covers the existing project list, project detail, dashboard, and project chat list. URL metric tags are normalized so project IDs do not create high-cardinality metrics.

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

These values are **candidate thresholds**, not proof of a committed production SLO:

- HTTP request failure rate: `< 1%`;
- p95 HTTP request duration: `< 1,000 ms`;
- p99 HTTP request duration: `< 2,500 ms`;
- k6 checks: `> 99%`;
- Renova journey failure rate: `< 1%`.

They match the initial on-call launch thresholds closely enough to make load evidence actionable. They must be calibrated from real staging and pilot measurements before being promoted to a contractual SLO.

## Protected external staging execution

`.github/workflows/load-slo-integrity.yml` has a manual `workflow_dispatch` job bound to the GitHub `staging` environment. It requires:

- `vars.STAGING_API_BASE_URL`;
- `secrets.STAGING_ADMIN_BEARER_TOKEN`;
- `secrets.STAGING_LOAD_TOKEN_POOL`;
- exact `release_sha` input;
- exact `image_digest` input;
- selected scenario;
- optional explicit bounded-write flag.

Before load starts, the workflow reuses `scripts/external-staging-release-smoke.sh`. That gate proves the URL currently serving traffic reports the expected Git SHA and image digest through health/readiness and protected release checks. This prevents a load report from being accidentally attached to a different deployment.

## Post-load reconciliation

A green HTTP graph is not enough. After k6 completes, `scripts/external-load-reconciliation.sh` fetches protected release health again and fails the gate when:

- the release SHA or image digest changed;
- poisoned outbox events are present;
- stale outbox leases are present;
- the oldest pending outbox item is older than 300 seconds.

The retained artifact contains the sanitized k6 summary, exact release identity, scenario, immutable k6 image, whether bounded writes were enabled, and post-load reconciliation. Bearer tokens are never written to the evidence artifact.

## Operational interpretation

During every real external staging run, correlate HTTP latency/errors with the existing observability and operational signals: PostgreSQL connection/pool behavior, Redis availability/latency, outbox pending/retryable/poisoned/oldest age, push/background workers, process CPU/memory and external-provider degradation where those signals exist.

A run that meets HTTP thresholds while queues grow without recovery is a failed capacity result. A run with missing telemetry is incomplete evidence, not a pass.

Real external Sentry/OTLP/log ingestion, provider metrics, paging delivery and human acknowledgement remain separate production proofs. This load gate does not fabricate them.

## Promotion rule

Do not state that Renova “supports N users” from scenario VU counts alone. Record the exact topology, fixture count, scenario, release identity, thresholds, queue state, resource saturation and any degraded providers. Capacity/SLO becomes **PROVEN for that tested staging topology only** when all gates pass and the evidence artifact is retained.
