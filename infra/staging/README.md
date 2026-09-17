# Staging runbook

What this is, and what it is not.

Until now the repository contained no deployment definition at all. `infra/`
held an OpenTelemetry collector config and a Grafana datasource;
`docker-compose.staging.yml` at the root starts a PostgreSQL and a Redis for a
local smoke test and nothing else; `scripts/deploy-prod.sh` activated a local
virtualenv and ran `uvicorn` with `DATABASE_URL` defaulting to
`renova:renova@localhost`. That script is kept, but it now refuses to run and
points here — it was never a deployment.

`docker-compose.yml` in this directory is the smallest honest staging
definition: the same immutable image as production, pinned by digest, running
the two documented process roles (`renova-api`, `renova-worker`) against
PostgreSQL and Redis.

## What it does not provide

Stating this plainly, because `PRODUCTION-READINESS.md` tracks each one as an
open blocker and a compose file must not be mistaken for closing them:

| Not provided | Tracked as |
|---|---|
| Managed PostgreSQL with PITR, backup and restore | #234 |
| TLS termination, DNS, certificates | #233 |
| Secret management (secrets come from an uncommitted env file) | #237 |
| External alert delivery and on-call | #235 |
| Measured capacity | #236 |

The `postgres` service here is a staging convenience. It is not a backup
strategy and must not become one.

## Prerequisites

* A promoted image digest from `backend-image.yml`. A floating tag turns "which
  build is running" into a guess.
* A reverse proxy in front of the API. The container listens on plain HTTP and
  is bound to loopback.
* `staging.env` next to this file, never committed. Start from
  `env.staging.example` at the repository root.

## Promote

```bash
cd infra/staging

# 1. Pin the exact artifact. Digest, not tag.
export RENOVA_IMAGE_DIGEST=sha256:<digest promoted by backend-image.yml>

# 2. The proxy address that may set X-Forwarded-For. Without this the
#    rate-limit bucket, the YooKassa IP allowlist and the audit trail all
#    record the proxy instead of the client.
export FORWARDED_ALLOW_IPS=10.0.0.0/8

# 3. Migrate, then start. `migrate` is a one-shot; api and worker wait for it
#    to complete successfully, so a failed migration stops the promotion
#    instead of serving traffic against a stale schema.
docker compose --env-file staging.env up -d

# 4. Prove the runtime, do not assume it.
curl -fsS http://127.0.0.1:8100/health | jq .
curl -fsS http://127.0.0.1:8100/ready  | jq .
```

`/health` reports the release SHA and artifact digest it is actually running.
Compare it with `RENOVA_IMAGE_DIGEST` before calling a promotion done.

`/ready` is the gate: it fails closed when the database or Redis is
unreachable, so a 503 here means do not route traffic yet.

## One-off operations

Legacy truth repairs no longer run at API startup in a deployed environment —
they used to execute on every deploy, restart and replica, with N replicas
racing concurrent passes over the same tables. Run them deliberately:

```bash
docker compose run --rm api python -m app.ops.truth_repair --dry-run
docker compose run --rm api python -m app.ops.truth_repair
```

## Roll back

```bash
export RENOVA_IMAGE_DIGEST=sha256:<previous digest>
docker compose --env-file staging.env up -d api worker
```

Note what this does and does not undo. It restores the previous code. It does
not undo a schema migration: Alembic `downgrade` is a separate, deliberate
decision, and several migrations are not loss-free in reverse (`w24` rounds
money to two decimals on the way up and cannot restore the discarded
floating-point noise on the way down — which is the intended truth, but it is
still not symmetric). Roll the image back first, then decide about the schema.
