# Canonical local MinIO image — #394

Status: **candidate implementation; exact CI qualification required**.

This annex governs only the development-only MinIO container used by the canonical `renova-local` Compose topology. It does not select or verify any staging/production object-storage provider.

## Finding

The previous canonical local Compose source was:

```text
minio/minio:RELEASE.2025-04-22T22-12-26Z
```

On 2026-09-12 the canonical-local-runtime workflow failed before Renova startup because Docker Hub returned pull access denied / repository unavailable for that source. The MinIO upstream release itself remains valid; the failure is registry-source availability.

## Candidate contract

Source `docker-compose.yml`, candidate blob `b047241c902dee3c4be08823c4ae23777175e5b9`:

```text
quay.io/minio/minio:RELEASE.2025-04-22T22-12-26Z@sha256:a1ea29fa28355559ef137d71fc570e508a214ec84ff8083e39bc5428980b015e
```

The release is intentionally unchanged. The digest is the immutable multi-platform index associated with that release. No migration to AIStor or another product family is part of this repair.

The canonical source contract in `scripts/devRuntimeContract.test.mjs`, candidate blob `34935f00a438f3b3053bc56ddb2639275265ef7e`, must fail when:

- the MinIO image is changed to mutable `latest`;
- the exact reviewed release/digest is absent;
- the unavailable Docker Hub `image: minio/minio:` source is restored.

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
2. the runner can pull the exact MinIO image/digest without authentication;
3. canonical `npm run dev -- doctor`, bootstrap/start/check path reaches healthy PostgreSQL, Redis and MinIO;
4. migrations run to the bundled Alembic head;
5. API `/health` and `/ready` pass;
6. worker heartbeat/runtime health passes;
7. local seed/check behavior remains idempotent where already contracted;
8. no production/staging credential or environment source is loaded.

A green repository workflow is `CI VERIFIED` / controlled local runtime evidence only. It is not staging, external-provider or production verification.
