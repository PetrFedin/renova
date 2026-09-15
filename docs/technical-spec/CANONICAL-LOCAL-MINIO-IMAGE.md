# Canonical local MinIO image and infrastructure pull resilience — #394 / #447

Status: **candidate implementation; exact CI qualification required**.

This annex governs the development-only MinIO source and the bounded registry-pull resilience used by the canonical `renova-local` Compose topology. It does not select or verify any staging/production object-storage provider.

## Finding

The previous canonical local Compose source was:

```text
minio/minio:RELEASE.2025-04-22T22-12-26Z
```

On 2026-09-12 the canonical-local-runtime workflow failed before Renova startup because Docker Hub returned pull access denied / repository unavailable for that source. The MinIO upstream release itself remains valid; the failure is registry-source availability.

The #425 bootstrap moved the same upstream release to an immutable Quay source. During later exact-candidate qualification, required-runtime jobs then encountered transient registry transport failures before services could start: Quay HTTP 502/504/header-timeout responses while pulling MinIO. A first #447 candidate successfully pre-pulled that immutable MinIO image but the same exact runtime then failed on a Docker Hub HTTP 502 while pulling Redis. That evidence proves the reliability boundary is the canonical local infrastructure registry-pull step, not MinIO alone.

Source validation, locked bootstrap and Compose graph validation had succeeded before these registry failures. Re-running an entire workflow by hand is therefore not an adequate reliability contract for a globally required check.

## Canonical MinIO image contract

Source `docker-compose.yml`, candidate blob `b047241c902dee3c4be08823c4ae23777175e5b9`:

```text
quay.io/minio/minio:RELEASE.2025-04-22T22-12-26Z@sha256:a1ea29fa28355559ef137d71fc570e508a214ec84ff8083e39bc5428980b015e
```

The release is intentionally unchanged. The digest is the immutable multi-platform index associated with that release. No migration to AIStor or another product family is part of this repair.

The canonical source contract in `scripts/devRuntimeContract.test.mjs` must fail when:

- the MinIO image is changed to mutable `latest`;
- the exact reviewed release/digest is absent;
- the unavailable Docker Hub `image: minio/minio:` source is restored.

## Bounded canonical infrastructure pull resilience

`scripts/localMinioPull.mjs` is the bounded pull helper introduced by #447. Despite the historical filename, its final candidate responsibility is the complete canonical local infrastructure pull set, not MinIO alone. Before infrastructure startup it executes one fixed Compose command equivalent to:

```text
docker compose --project-name renova-local --env-file <local-env> -f docker-compose.yml pull postgres redis minio
```

Its contract is deliberately narrow:

- the Docker Compose project, env file and Compose file are supplied by the canonical local runtime;
- the service list is fixed in source to `postgres`, `redis`, `minio` and cannot be selected from user input;
- the local Docker-context guard in `scripts/dev-runtime.sh` executes before the helper;
- default retry budget is 3 attempts, configurable only within the bounded range 1–5;
- default delay is 2 seconds, bounded to 0–30 seconds;
- retry is allowed only for classified transport/transient failures such as registry HTTP 502/503/504, header/TLS/I/O timeouts, connection reset, temporary DNS failure, context deadline and unexpected EOF;
- authorization failure, access denial, unknown manifest, invalid reference or digest mismatch are not retryable and fail immediately;
- every retry uses exactly the same Compose command and service list, so no alternate registry/tag/digest fallback exists;
- exhaustion remains a hard failure of `source-and-runtime`.

This reliability patch does not make every current Compose source immutable. PostgreSQL and MinIO are digest-pinned in the current canonical Compose source. Redis currently remains the existing versioned `redis:7.4.2-alpine` source; #447 retries that exact canonical Compose reference but does not claim digest immutability or silently change its source. Any Redis source-pinning hardening is a separate supply-chain change.

After a successful pre-pull, the existing `compose up -d postgres redis minio` path remains authoritative. Runtime health, migration, API/worker readiness, repeatable seed and focused contracts are unchanged and still have to succeed.

`scripts/localMinioPullRetry.test.mjs` provides deterministic negative and recovery coverage for classification, Redis/registry transient-then-success, bounded exhaustion, immediate non-transient failure, the fixed three-service list and exact command reuse. The deterministic test runs through focused local contracts. Before the real topology starts, `scripts/dev-runtime.sh start` executes the same helper against the canonical Compose infrastructure pull path.

## Unchanged local semantics

This repair does not change:

- service names `postgres`, `redis`, `minio`;
- PostgreSQL database/port/volume semantics;
- Redis endpoint/port/runtime command semantics;
- MinIO endpoint `http://minio:9000` / host `127.0.0.1:9000`;
- MinIO console port `9001`;
- local MinIO credentials `renova` / `renova123`;
- bucket `renova`;
- `/data` volume;
- `server /data --console-address :9001` command;
- API, worker or migration topology;
- external provider credentials, which remain disabled/empty locally.

## Acceptance evidence

Before merge eligibility the exact candidate must prove:

1. `devRuntimeContract.test.mjs` passes with the immutable Quay MinIO source;
2. `localMinioPullRetry.test.mjs` proves a transient infrastructure registry failure can recover with the exact same command, retry exhaustion fails closed, and a non-transient image/source error is not retried;
3. the helper's service list remains exactly `postgres redis minio` and no alternate source can be selected;
4. the runner can establish the canonical local infrastructure images, including bounded recovery if a registry first returns a classified transient error;
5. canonical `npm run dev -- doctor`, bootstrap/start/check path reaches healthy PostgreSQL, Redis and MinIO;
6. migrations run to the bundled Alembic head;
7. API `/health` and `/ready` pass;
8. worker heartbeat/runtime health passes;
9. local seed/check behavior remains idempotent where already contracted;
10. no production/staging credential or environment source is loaded;
11. no fallback registry/tag/digest or required-check weakening is introduced.

A green repository workflow is `CI VERIFIED` / controlled local runtime evidence only. It is not staging, external-provider or production verification.

## Evidence boundary

The retry policy addresses only transient registry transport dependencies while establishing the canonical local/CI infrastructure topology. It is not a generic retry policy for business/provider operations and does not prove any registry's availability. A failed retry budget remains explicit evidence that the required local-runtime check could not establish runtime truth.
