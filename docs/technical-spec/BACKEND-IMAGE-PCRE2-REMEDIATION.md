# Backend image PCRE2 remediation — #388 / #672

Status: **active remediation lineage; #672 candidate requires exact-head CI and owner review before merge**.

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

## 2026-10-07 security-version rollover — #672

The original `10.42-1+deb12u1` remediation was correct for DLA-4772-1, but an exact package pin is reproducible only while that version remains available from the configured repository. On 2026-10-07 the canonical image job completed `apt-get update` successfully and then failed because Bookworm security no longer offered the exact `10.42-1+deb12u1` binary.

Debian's authoritative security tracker now lists Bookworm security source version `10.42-1+deb12u2`. DLA-4816-1 fixes the newer `CVE-2026-103111` in that version. The bounded #672 repair therefore preserves the same immutable Python base digest and updates only the exact PCRE2 runtime package pin:

```text
apt-get update
apt-get install --no-install-recommends libpcre2-8-0=10.42-1+deb12u2
assert installed version == 10.42-1+deb12u2
remove /var/lib/apt/lists/*
```

Authoritative external references used for this rollover:

- Debian Security Tracker, source package `pcre2`: Bookworm security `10.42-1+deb12u2`;
- DLA-4816-1: `CVE-2026-103111`, Bookworm fixed version `10.42-1+deb12u2`.

The control remains fail closed: no unpinned `apt upgrade`, no Trivy exception and no severity downgrade. Future Debian security-version rollovers remain explicit reviewed source changes rather than silent floating package resolution.

### #672 acceptance

The exact #672 candidate must prove all existing image acceptance items plus:

- apt resolves the reviewed `10.42-1+deb12u2` version from configured Bookworm sources;
- the resulting image reports that exact installed package version;
- refreshed Trivy data finds no fixed HIGH/CRITICAL issue that the candidate suppresses;
- unrelated npm/Python advisory policy remains independently governed and is not bundled into this image repair.


## 2026-10-07 follow-up base-layer findings

Once the PCRE2 package became resolvable, the fail-closed Trivy gate reached the completed runtime image and exposed seven additional fixed HIGH/CRITICAL findings. All seven map to the same Debian package identity: `perl-base 5.36.0-7+deb12u3`, with the reviewed fixed Bookworm version `5.36.0-7+deb12u4`.

The bounded repair therefore does not perform a floating distribution upgrade. The runtime image installs and asserts exactly:

- `libpcre2-8-0=10.42-1+deb12u2`;
- `perl-base=5.36.0-7+deb12u4`.

Acceptance remains the existing Trivy fixed HIGH/CRITICAL gate. No vulnerability IDs are suppressed, no severity is downgraded, and any newly fixed finding still fails the image qualification.
