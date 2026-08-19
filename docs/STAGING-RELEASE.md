# Renova external staging release contract

Renova's local `docker-compose.staging.yml` and `Staging runtime integrity` workflow remain CI/runtime fixtures. They are not evidence that a production-like external staging environment exists.

This document defines the repository-side contract for proving an **already deployed external staging release** without pretending that Renova has a cloud provider configured when it does not.

## What is now canonical

A staging candidate is identified by both:

- the exact Git commit SHA;
- the exact GHCR image digest: `ghcr.io/petrfedin/renova-api@sha256:...`.

A mutable tag such as `latest`, `main` or a rebuilt image is not a staging release identity.

The deployment platform must inject the promoted digest into the API container as:

```text
RENOVA_IMAGE_DIGEST=sha256:<64 hex characters>
```

`RENOVA_GIT_SHA` remains baked into the canonical image build. `/health` and `/ready` expose both values. A missing deployment-supplied digest is exposed as `unknown`; the external staging gate rejects it.

## GitHub environment contract

Create/protect a GitHub environment named `staging` and configure:

- environment variable `STAGING_API_BASE_URL` — the real public HTTPS API origin, with no placeholder or localhost value;
- environment secret `STAGING_ADMIN_BEARER_TOKEN` — a staging-only admin Bearer token allowed to read H0/release-health.

The token is used only as an HTTP Authorization header. The workflow does not write response bodies to a long-lived artifact and does not echo the token.

The environment should use required reviewers/approval rules appropriate to the team before it is used as a release gate.

## Provider handoff

The repository currently contains no Railway, Render, Fly.io, Cloud Run, ECS, Terraform, Pulumi, Helm or other provider-specific deployment definition. Therefore the repository cannot honestly provision DNS, TLS, managed PostgreSQL, managed Redis, storage or API replicas by itself.

The chosen infrastructure provider must perform these steps before the verification workflow runs:

1. Pull/promote the exact GHCR digest; do not rebuild the commit.
2. Apply production-like database migrations using the same reviewed release artifact/toolchain.
3. Run the API with production/staging policy, demo seed disabled and real managed dependencies.
4. Set `RENOVA_IMAGE_DIGEST` to the promoted digest.
5. Make the release available through the real staging HTTPS origin.

After that, run **External staging release** manually with:

- `release_sha` = the exact 40-character Git SHA;
- `image_digest` = the exact `sha256:...` digest (without repository prefix).

## What the gate proves

`scripts/external-staging-release-smoke.sh` fails closed unless all of the following are true:

- the endpoint is real HTTPS and not localhost/`example.com`;
- `/health` reports `environment=staging`, the expected Git SHA and the expected image digest;
- `/ready` reports `ready` with the same Git SHA and image digest, proving database + shared rate-limit Redis readiness through the API's canonical readiness contract;
- protected H0 readiness is reachable with Bearer authentication and reports the staging environment;
- protected release-health is reachable and exposes the expected integration/outbox operational surface.

A successful run stores only a sanitized verification record containing environment, SHA, digest and high-level status. It does not store the Bearer token or provider response payloads.

## What this does not yet prove

Even a successful external staging release verification is **not** proof of:

- two or more API replicas;
- worker/API topology separation;
- automated backups, PITR or a successful restore drill;
- capacity/SLO compliance;
- alert delivery to an on-call owner;
- external provider reconciliation under outage;
- production DNS/TLS ownership or production credentials;
- a real-user pilot.

Those remain separate production gates and must be closed with evidence, not inferred from CI.
