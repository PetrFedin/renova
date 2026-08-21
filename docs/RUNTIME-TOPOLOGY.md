# Renova backend runtime topology

Renova keeps one reviewed, immutable backend image and exposes two process roles from that exact artifact.

## Process commands

- `renova-api` — HTTP/FastAPI serving plus the Redis WebSocket subscriber bridge required by each API replica.
- `renova-worker` — durable background processing: domain outbox dispatch, automation reminders (when enabled), and Expo push-receipt reconciliation (when enabled).

The default image command is `renova-api`. Staging and production must explicitly deploy at least one `renova-worker` instance from the **same image digest** promoted to the API tier.

## Ownership boundary

API replicas do not start durable background job loops. Scaling HTTP capacity therefore does not multiply job runners or put job CPU/memory failures inside the request-serving process. The WebSocket Redis subscriber remains API-local because it fans shared Redis messages into the connections owned by that API process.

Worker correctness continues to rely on the existing database/Redis idempotency, leases and fencing primitives. The topology split does not create a new queue, service database or microservice protocol.

## Health contract

The image has one role-aware Docker healthcheck:

- API role: `/ready` must be HTTP 200 and report `service=renova-api`.
- Worker role: `/tmp/renova-worker-heartbeat.json` must contain a fresh healthy worker heartbeat.
- Unknown/missing runtime role: unhealthy (fail closed).

A deployed worker refreshes the local heartbeat only after the shared Redis heartbeat succeeds. If the worker loses the shared Redis control plane, its Redis key expires and its local heartbeat becomes stale instead of remaining falsely healthy.

## Shared worker visibility

Worker instances publish bounded TTL heartbeats under `renova:runtime:worker:*`. `/api/v1/admin/release-health` and `/api/v1/automation/worker` use these shared heartbeats rather than process-local API counters.

A worker pool is healthy only when at least one live worker exists and, when the API has a known Git release SHA, at least one live worker reports the same release SHA. A live old worker during a rollout is visible but cannot make the current API release appear fully healthy by itself.

Heartbeat payloads contain only bounded operational identity (hashed instance id, release/digest, timestamps and active task names). Redis credentials/URLs are never returned by the health API.

## Scaling and failure domains

Scale `renova-api` for request/WebSocket load. Scale `renova-worker` for background backlog/provider throughput. Do not scale one tier merely to increase capacity in the other.

Repository CI proves the topology with one built image, PostgreSQL, Redis, two API containers and one worker container. The smoke test verifies:

1. both API replicas and the worker become healthy from the same image;
2. only the API replicas own the WebSocket bridge;
3. only the worker owns the durable job loops and shared heartbeat;
4. stopping the worker leaves both APIs ready;
5. graceful worker shutdown removes its shared heartbeat;
6. restarting the worker restores health/heartbeat;
7. stopping one API leaves the peer API and worker healthy.

## Deployment rule

Build once, identify by Git SHA and digest, then deploy/promote that exact digest to both roles. Do not rebuild separately for API and worker. Migrations remain a separate pre-deploy step; neither process command is the migration runner.

## Evidence boundary

This repository contract and CI smoke prove process separation and same-image behavior. They do **not** prove that the external managed staging or production environment has actually deployed the topology, that provider credentials are valid, or that on-call alerts reach a human. Those remain separate environment/operations gates.
