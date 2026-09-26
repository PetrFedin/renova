# Backend image PCRE2 remediation — #388

Status: **candidate implementation; CI and owner review required before merge**.

This annex records the bounded repository-side remediation for two newly fixable HIGH findings discovered by the canonical `Backend image integrity` workflow while qualifying recovery PR #383 on 2026-09-12. It does not claim an external staging or production deployment.

## Finding

The pinned runtime base in `backend/Dockerfile` is `python:3.12.13-slim-bookworm@sha256:d50fb7611f86d04a3b0471b46d7557818d88983fc3136726336b2a4c657aa30b`.

The refreshed Trivy database reported the final runtime image carrying Debian `libpcre2-8-0 10.42-1` with two fixed HIGH findings:

- `CVE-2026-86145` — fixed by Debian package `10.42-1+deb12u1`;
- `CVE-2026-89161` — fixed by Debian package `10.42-1+deb12u1`.

The same failed workflow had already passed image build, immutable revision metadata, command and non-root checks before the vulnerability gate. Therefore this task is a supply-chain remediation and does not redefine the recovery/business logic under test.

## Bounded repair

The Python base digest remains unchanged. The runtime stage performs:

```text
apt-get update
apt-get install --no-install-recommends libpcre2-8-0=10.42-1+deb12u1
assert installed version == 10.42-1+deb12u1
remove /var/lib/apt/lists/*
```

The package version is exact. No Trivy exception, severity downgrade, mutable `latest` tag, provider/runtime-policy weakening or broad distribution upgrade is introduced.

Source: `backend/Dockerfile`, candidate blob `6ffbd522401d60748e89c4a200e3c5b4b7fdbb9b`.

## Required acceptance evidence

Before merge eligibility, the exact candidate SHA must prove through repository CI:

1. backend image builds from the pinned Python digest;
2. installed `libpcre2-8-0` is the fixed package;
3. Trivy fixed HIGH/CRITICAL gate is green without ignore/exception expansion;
4. immutable OCI revision equals the evaluated Git SHA;
5. image runs as the established non-root user;
6. API `/health` and `/ready` checks pass;
7. worker role/heartbeat health checks pass;
8. full backend regression and PostgreSQL Alembic upgrade do not regress;
9. technical-spec, security and PR-policy gates remain green.

## Evidence boundary

Repository CI can establish **CI VERIFIED** for the candidate image. It cannot establish `STAGING VERIFIED`, `EXTERNALLY VERIFIED` or `PRODUCTION VERIFIED` until the exact artifact/digest is promoted and retained external-runtime evidence exists.

After this repair is owner-reviewed and merged, recovery branches whose image gates failed only because of these two inherited PCRE2 findings must be rebased/requalified; their old red image runs are not retroactively green.