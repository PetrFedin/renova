# Renova backend production artifact

Renova deploys the backend as an immutable container artifact. A Git checkout, a Poetry resolution performed during deployment, or a mutable `latest` image is not a release artifact.

## Canonical identity

The canonical image is published only from `main` after the image validation job succeeds:

```text
ghcr.io/petrfedin/renova-api:sha-<40-character-git-sha>
```

The registry digest returned by the publish step is the authoritative artifact identity. Staging and production promotion must reference that digest (`ghcr.io/petrfedin/renova-api@sha256:...`), not rebuild the commit and not substitute a mutable tag.

The image exposes the source Git SHA through the OCI `org.opencontainers.image.revision` label and the `RENOVA_GIT_SHA` runtime variable. `/health` and `/ready` return the same release identity so an operator can prove which commit is serving traffic.

## Build contract

`backend/Dockerfile`:

- uses Python 3.12.13, matching the backend dependency contract;
- pins the Docker Official Python base by registry digest so base-image movement requires a reviewed source change;
- installs the exact Poetry 2.4.1 toolchain in the builder stage;
- installs runtime dependencies only from the committed `backend/poetry.lock`;
- copies only the runtime virtualenv, application code and migration files into the final stage;
- removes `pip`, `setuptools`, `wheel` and Python `ensurepip` from the runtime artifact after dependency integrity has been checked in the builder;
- runs as uid/gid `10001:10001`;
- does not contain the repository, tests, local env files or Node workspace;
- provides a liveness `HEALTHCHECK` against `/health`.

The root `.dockerignore` makes the backend runtime files the only build context admitted to the image build.

## Runtime dependency security

The first container scan exposed fixed HIGH advisories in the previously locked HTTP stack and in package-manager tooling that was unnecessary at runtime. The image gate was not relaxed.

The reviewed runtime graph pins FastAPI `0.139.2` and `python-multipart` `0.0.32`; the lockfile resolves Starlette `1.6.0`. FastAPI `0.139.2` is deliberately used instead of the later `0.140.x`/`0.141.x` line because it contains the upstream `_IncludedRouter` concurrent cache rebuild fix while avoiding a newer route-handler cache implementation that is not required by Renova. The route-integrity tests use FastAPI's public `iter_route_contexts()` API instead of assuming `router.routes` is a flat list. Calendar read and mutation contracts, OTP route uniqueness, and administrative route/ordering guards all use the same effective route-tree traversal.

Build/package-manager tooling is removed from the final image rather than promoted into the application runtime solely to satisfy a scanner.

Any later fixed HIGH or CRITICAL OS/library finding remains a release blocker in `Backend image integrity`. Unfixed findings remain visible to the scanner, but are not converted into invented patched versions or unsupported dependency overrides.

## Runtime probes

`GET /health` is the liveness contract. It proves the API process can answer and includes the build release identity. It intentionally does not claim that PostgreSQL or Redis are healthy.

`GET /ready` is the traffic-readiness contract. It executes a database probe and validates the deployed shared rate-limit Redis backend. Dependency failure returns HTTP 503 without exposing provider error details.

A platform should use `/ready` for load-balancer readiness and `/health` for process liveness. A transient database/provider failure must remove an instance from traffic without pretending the process itself is dead.

## CI and publication

`.github/workflows/backend-image.yml` validates every image-affecting pull request by:

1. building the image from the exact commit;
2. proving the OCI revision label and non-root runtime user;
3. failing on fixed high/critical OS or library vulnerabilities reported by Trivy;
4. booting the image and exercising `/health` and `/ready`;
5. proving the runtime release identity equals the workflow Git SHA.

After the same validation succeeds on `main`, the workflow publishes exactly one SHA tag with BuildKit SBOM/provenance attestations and signs the resulting registry digest using Sigstore keyless signing.

## Promotion rule

The release lifecycle must preserve one artifact identity:

```text
commit -> build/publish once -> registry digest -> staging -> production
```

Staging and production may differ in configuration, credentials and scale. They must not differ by rebuilding application code or resolving dependencies again. Rollback therefore means selecting a previously validated digest; forward-fix means publishing a new Git SHA and a new digest.
