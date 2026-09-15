# Canonical local MinIO image — #394 / #447

Status: **candidate implementation; exact CI qualification required**.

This annex governs only the development-only MinIO container used by the canonical `renova-local` Compose topology. It does not select or verify any staging/production object-storage provider.

## Finding

The previous canonical local Compose source was:

```text
minio/minio:RELEASE.2025-04-22T22-12-26Z
```

On 2026-09-12 the canonical-local-runtime workflow failed before Renova startup because Docker Hub returned pull access denied / repository unavailable for that source. The MinIO upstream release itself remains valid; the failure is registry-source availability.

The #425 bootstrap moved the same upstream release to an immutable Quay source. During later exact-candidate qualification on 2026-09-14, independent required-runtime jobs then encountered transient Quay transport failures before services could start: HTTP 502, HTTP 504 and `Client.Timeout exceeded while awaiting headers`. Source validation, locked bootstrap and Compose graph validation had already succeeded. Re-running an entire workflow by hand is therefore not an adequate reliability contract for a globally required check.

## Canonical image contract

Source `docker-compose.yml`, candidate blob `b047241c902dee3c4be08823c4ae23777175e5b9`:

```text
quay.io/minio/minio:RELEASE.2025-04-22T22-12-26Z@sha256:a1ea29fa28355559ef137d71fc570e508a214ec84ff8083e39bc5428980b015e
```

The release is intentionally unchanged. The digest is the immutable multi-platform index associated with that release. No migration to AIStor or another product family is part of this repair.

The canonical source contract in `scripts/devRuntimeContract.test.mjs` must fail when:

- the MinIO image is changed to mutable `latest`;
- the exact reviewed release/digest is absent;
- the unavailable Docker Hub `image: minio/minio:` source is restored.

## Bounded registry-transport resilience

`scripts/localMinioPull.mjs` performs an explicit pre-pull of the canonical Compose service `minio` before infrastructure startup. It is deliberately narrow:

- the Docker Compose project, env file and Compose file are supplied by the canonical local runtime;
- the command is fixed to `docker compose ... pull minio`;
- the local Docker-context guard in `scripts/dev-runtime.sh` executes before the helper;
- default retry budget is 3 attempts, configurable only within the bounded range 1–5;
- default delay is 2 seconds, bounded to 0–30 seconds;
- retry is allowed only for classified transport/transient failures such as registry HTTP 502/503/504, header/TLS/I/O timeouts, connection reset, temporary DNS failure, context deadline and unexpected EOF;
- authorization failure, access denial, unknown manifest, invalid reference or digest mismatch are not retryable and fail immediately;
- every retry uses exactly the same Compose service and therefore the same reviewed image release/digest;
- no alternate registry, tag, digest or product fallback exists;
- exhaustion remains a hard failure of `source-and-runtime`.

After a successful pre-pull, the existing `compose up -d postgres redis minio` path remains authoritative. Runtime health, migration, API/worker readiness, repeatable seed and focused contracts are unchanged and still have to succeed.

`scripts/localMinioPullRetry.test.mjs` provides deterministic negative and recovery coverage for classification, transient-then-success, bounded exhaustion and immediate non-transient failure. The deterministic test runs through focused local contracts. Before the real topology starts, `scripts/dev-runtime.sh start` executes the same helper against the canonical immutable MinIO pull path.

## Unchanged local semantics

This repair does not change:

- service name `minio`;
- endpoint `http://minio:9000` / host `127.0.0.1:9000`;
- console port `9001`;
- local credentials `renova` / `renova123`;
- bucket `renova`;
- `/data` volume;
- `server /data --console-address :9001` command;
- PostgreSQL, Redis, API, worker or migration topology;
- external provider credentials, which remain disabled/empty locally.

## Acceptance evidence

Before merge eligibility the exact candidate must prove:

1. `devRuntimeContract.test.mjs` passes with the immutable Quay source;
2. `localMinioPullRetry.test.mjs` proves one transient failure can recover with the same command, retry exhaustion fails closed, and a non-transient image/source error is not retried;
3. the runner can pull the exact MinIO image/digest without authentication, including bounded recovery if the registry first returns a classified transient error;
4. canonical `npm run dev -- doctor`, bootstrap/start/check path reaches healthy PostgreSQL, Redis and MinIO;
5. migrations run to the bundled Alembic head;
6. API `/health` and `/ready` pass;
7. worker heartbeat/runtime health passes;
8. local seed/check behavior remains idempotent where already contracted;
9. no production/staging credential or environment source is loaded;
10. no fallback registry/tag/digest or required-check weakening is introduced.

A green repository workflow is `CI VERIFIED` / controlled local runtime evidence only. It is not staging, external-provider or production verification.

## Evidence boundary

The retry policy addresses only a transient registry-transport dependency in the canonical local/CI bootstrap. It is not a generic retry policy for business/provider operations and does not prove Quay availability. A failed retry budget remains explicit evidence that the required local-runtime check could not establish runtime truth.
