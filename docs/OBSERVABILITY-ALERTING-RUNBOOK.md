# Renova observability and alerting runbook

Status: production-hardening contract for issue #235. This document defines initial operational thresholds and the staging evidence required before an alert path may be called operational. It does **not** claim that any external Sentry, OTLP, log, email, pager or on-call destination is already receiving data.

## 1. Source-of-truth principles

1. `configured` means only that Renova accepted the local configuration and initialized the SDK/exporter.
2. `emitted` means the application handed a synthetic event/span/metric to its configured SDK/exporter.
3. `ingested` requires evidence from the external telemetry backend containing the same release/artifact identity and, for a drill, the same `probe_id` where applicable.
4. `alerted` requires evidence that an alert rule fired from the ingested signal.
5. `delivered` requires evidence from the configured on-call destination or notification channel.
6. `acknowledged` requires a human acknowledgement with timestamp and owner.
7. Repository code must never set `external_delivery_confirmed=true` merely because an SDK call returned successfully.

## 2. Mandatory production telemetry contract

Production startup is expected to fail closed when Sentry, secure non-local OTLP, structured JSON logging or required release configuration is invalid. API and worker use the same reviewed observability bootstrap. Every deploy must carry `RENOVA_GIT_SHA` and `RENOVA_IMAGE_DIGEST`; telemetry without immutable release identity is not acceptable release evidence.

Operational dashboards must preserve at least: environment, service, release SHA, image digest and request correlation ID. User IDs, authorization headers, provider credentials, DSNs, webhook secrets and arbitrary logging `extra` fields are not observability dimensions.

## 3. Initial alert matrix

These are starting thresholds for staging/production calibration, not claimed historical SLOs. Tune only from measured traffic and retain the change rationale.

| Surface | Signal | Warning | Page / critical | Primary owner | First response |
| --- | --- | --- | --- | --- | --- |
| API availability | `/ready` failures | 1 failed poll | 2 consecutive failed polls or >60 s unavailable | Platform | Check release identity, DB and Redis; rollback only after identifying whether failure is release-specific |
| API errors | 5xx request ratio | >2% for 5 min | >5% for 5 min | Backend | Split by route/release; inspect correlated exceptions and recent deploy |
| API latency | p95 server latency | >1.5 s for 10 min | >3 s for 10 min | Backend | Inspect DB pool, provider latency, N+1/regression and saturation |
| PostgreSQL | pool utilization | >=80% for 5 min | >=95% for 2 min or pool timeout >0 | Backend/DB | Inspect checked-out/overflow, long queries and transaction age |
| PostgreSQL | connectivity/revision | any preflight/readiness failure | persistent >60 s | Platform/DB | Verify network, credentials, Alembic head and DB health before restart loops |
| Redis | ping / shared runtime | 1 transient failure | 2 consecutive failures or shared heartbeat expiry | Platform | Check Redis connectivity; auth/OTP/rate-limit/runtime topology can be affected |
| Worker | heartbeat | age >10 s | missing/expired at 20 s TTL | Backend/Platform | Inspect worker process and first failed durable task; do not substitute API background loops |
| Worker tasks | unexpected task exit | n/a | any unexpected exit | Backend | Capture task name/exception/release; worker should exit non-zero rather than run partially |
| Domain outbox | oldest pending age | >2 min | >5 min | Backend | Inspect worker, handler failures and provider dependencies |
| Domain outbox | dead letters | n/a | any new dead letter | Backend/Operations | Triage event type, attempts, error class, safe replay eligibility and business impact |
| Payments | provider/webhook/reconciliation error | any isolated error with recovery | unresolved >5 min or repeated failures for same provider | Payments/Backend | Verify provider truth before changing local payment state; reconcile, never guess |
| Push receipts | unresolved/failed receipt lag | >5 min | >15 min or sustained growth | Mobile/Backend | Inspect APNs/provider response, receipt worker and token invalidation path |
| OCR / email | provider failures | >2 failures in 10 min | critical workflow blocked >15 min | Backend/Operations | Check provider mode, credentials, queue/outbox and fallback policy |
| External providers | reconciliation backlog | >5 min oldest unresolved | >15 min or business-critical mismatch | Backend/Operations | Use provider reconciliation truth; preserve provider request/response correlation without secrets |
| Observability pipeline | synthetic staging drill | event emitted but not ingested within 2 min | no alert delivery within 5 min | Platform | Treat telemetry path as non-operational; do not promote staging evidence to production claim |

## 4. Staging alert-delivery drill

Run the probe **inside the deployed staging backend artifact**, not from a developer laptop. The command is deliberately not an HTTP endpoint and requires an explicit confirmation flag.

```bash
cd backend
poetry run python scripts/observability_alert_probe.py --confirm-staging --json
```

Optional deterministic operator correlation:

```bash
poetry run python scripts/observability_alert_probe.py \
  --confirm-staging \
  --probe-id 11111111-2222-4333-8444-555555555555 \
  --json
```

The probe refuses to run unless all of the following are true: environment is `staging`; `SENTRY_DSN` is configured; OTLP endpoint is configured, external/non-local and secure; `LOG_JSON=true`; `RENOVA_GIT_SHA` and `RENOVA_IMAGE_DIGEST` are known. It emits one synthetic Sentry exception, one error span, one counter increment and one structured error log. The UUID is not added to metric labels, avoiding unbounded metric cardinality.

The local receipt intentionally reports `external_delivery_confirmed=false`. A successful command is **not** enough to pass the drill.

## 5. Evidence packet required to pass the drill

Record one immutable evidence packet per probe:

| Evidence field | Required proof |
| --- | --- |
| `probe_id` | exact UUID from local receipt |
| release | exact `RENOVA_GIT_SHA` from receipt and external event |
| artifact | exact `RENOVA_IMAGE_DIGEST` from receipt/deployment metadata |
| emission time | UTC timestamp from receipt/structured log |
| structured log ingestion | external log record with same probe ID/release/artifact |
| Sentry ingestion | external event ID or screenshot/link showing synthetic exception and same probe ID |
| OTLP trace ingestion | trace/span evidence with `renova.alert_probe_id` and error status |
| metric ingestion | counter increase around the drill timestamp; UUID correlation is intentionally not a metric label |
| alert firing | rule/event evidence showing the synthetic error met the staging alert rule |
| alert delivery | destination evidence (pager/email/chat system) with delivery timestamp |
| acknowledgement | human owner + UTC acknowledgement timestamp |
| recovery | UTC resolution timestamp and confirmation that the synthetic alert is closed/silenced |

Pass criteria: external log + Sentry + trace + metric are visible for the same deployed artifact, the configured alert fires, delivery is visible at the destination, and a human acknowledges it within the staging target. Missing any external evidence keeps the status `configured_unverified` / `external_delivery_confirmed=false`.

## 6. Drill safety and cleanup

The probe contains no user payload, project data, credentials or provider secrets. Use only the generated UUID, release SHA and image digest for correlation. Do not paste DSNs, tokens, request bodies or production identifiers into evidence.

After the drill, close the synthetic Sentry issue/alert according to the provider workflow and annotate it as a staging drill. Do not suppress the production rule globally. If the probe does not appear externally, diagnose exporter/network/routing configuration before retrying; repeated local emission without external evidence is not progress.

## 7. Incident ownership

Platform owns telemetry transport, release identity, collector/log ingestion and pager delivery. Backend owns application error/latency, PostgreSQL pool behavior, Redis usage, worker topology, outbox and provider reconciliation. Payments owns payment-provider business truth jointly with Backend. Mobile owns push-device/token behavior jointly with Backend. Operations owns business impact triage and human acknowledgement/escalation.

A page has one incident owner. Cross-domain responders may assist, but ownership is not transferred implicitly by commenting in a chat or restarting a service.

## 8. Promotion gate

Issue #235 must not be closed solely from repository tests. Code/tests can prove fail-fast configuration, safe telemetry enrichment and correct probe behavior. Closure requires at least one real staging evidence packet demonstrating external ingestion and alert delivery from the immutable deployed artifact. Production alerting should then use the same reviewed rules/destinations or an explicitly documented production-specific mapping.
