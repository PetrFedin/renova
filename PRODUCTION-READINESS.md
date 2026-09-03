# Renova — Production Readiness

**Broad production launch:** **BLOCKED_FOR_BROAD_PRODUCTION**  
**Machine-readable source of truth:** `docs/production-readiness-evidence.json`  
**SHA-bound evidence:** GitHub Actions artifact `production-readiness-snapshot` from `Production readiness integrity`.

This document records current repository truth and separates repository/CI evidence from external staging, provider, production and operator evidence.

## 1. Current repository facts

The evaluated Git SHA is supplied by CI. `scripts/production_readiness.py` resolves the exact evaluated SHA, live `main`, current Alembic graph head, mobile source identity and live blocker issue state.

| Fact | Current value |
|---|---:|
| Alembic head | `w18nativeenumparity01` |
| Mobile version | `0.3.7` |
| iOS buildNumber | `3` |
| Android versionCode | `3` |
| Backend artifact contract | `ghcr.io/petrfedin/renova-api:sha-${GIT_SHA}` |
| Runtime roles | `renova-api` + `renova-worker` from one immutable image |

## 2. What repository CI currently proves

Current exact-candidate gates cover full backend regression + PostgreSQL Alembic upgrade, API/UI Playwright E2E, canonical local PostgreSQL/Redis/MinIO/API/Worker topology, health/readiness/heartbeat, schema/ORM parity, DomainOutbox retry/lease/DLQ recovery, provider reconciliation foundations, auth/RBAC/object ACL/WebSocket security, CodeQL/dependency/Gitleaks/container security, repository backup/isolated restore, exact locked backend toolchain and living technical-spec integrity.

A green repository gate is **CI VERIFIED** only. It does not prove external staging, production deployment, live providers, managed backup restore, alert delivery, mobile-store release or real capacity.

## 3. Current product-integrity state

### DONE / CI VERIFIED

**Canonical development runtime — PR #288.** Exact successor head `46fb8aaf52c33449b3a168ee226c605a94c0d3d4`; merge `7bd1dceb273a7e1f26ddf2333e9199d8d498ae54`.

**Repository DR regression — PR #290.** Head `a85528303f6e6704ac8a0feaa6845e7ddfc9c93a`, `Database restore integrity` run `33344103969`, merge `748ed5f22db0bfe18001f276ec521d0198d4dc57`. This is not a managed-provider production restore.

**Chat read truth — PR #270.** Authoritative read cursor, side-effect-free reads, monotonic read-state reconciliation and mobile visibility-gated read behaviour are merged. Equal-timestamp precision remains P2 #271.

**Phone chat invitation delivery — PR #277.** Durable invitation intent, DomainOutbox delivery, provider ambiguity fencing, thread ACL/inbox/WS and truthful mobile delivery state are merged. Real Twilio round-trip remains externally unverified.

**Incoming chat atomicity/idempotency — PR #292.** Head `ca0be7ba75949879b538ef654ac36869ce0a3f96`, merge `9d3f96bad6138aef7f7db32407162fe07897572d`. S3 ambiguous-write/orphan recovery remains #238.

**Warranty create atomicity/idempotency — PR #295 / #266 CLOSED.** Exact qualified head `22dd1f2d379f3d2f26278b58b03a1ca4f022da3c`; squash merge `9fed24c1b59d767daef4d6395fd01cb303c838e3`. Dedicated `Warranty claim PostgreSQL integrity` run `33795110887` passed canonical migration, focused atomicity/mobile contracts and the real two-session PostgreSQL race. Full CI run `33795110854` (`#4557`) passed full backend regression, PostgreSQL Alembic upgrade, Playwright API/UI, mobile and relevant integrity contracts. Stable mobile request identity, generic `ClientWriteRequest`, atomic Issue + warranty Document + DomainOutbox and replay/conflict semantics are therefore CI VERIFIED. This does not close #238 or any external environment claim.

### ACTIVE / INCOMPLETE

**Manual payment evidence — #265.** `paid_unverified` exists, but evidence upload/version → authorized approve/reject → safe resubmit → exactly-once financial recognition is incomplete. `paid_unverified` remains non-financial truth; approval must reuse canonical `Payment confirmed → expense_from_payment → refresh_budget_facts`, with no separate `Project.budget_spent` writer.

**Provider/S3 recovery — #238.** External authoritative read/recovery gaps and S3 ambiguous-write/orphan recovery remain open.

## 4. External environment truth

| Environment | Status | Truth |
|---|---|---|
| Isolated CI staging | `CI VERIFIED` | Repository topology/contracts execute on exact candidates. |
| Persistent external production-like staging | `NOT EXTERNALLY VERIFIED` | No retained current exact-digest TLS/DNS/managed-dependency/provider-sandbox evidence. #233. |
| Production | `NOT EXTERNALLY VERIFIED` | No retained exact deployed Git SHA + image digest + runtime evidence. |

## 5. Provider truth

YooKassa and FNS have repository durable reconciliation but live credentials/liveness are unverified. «Мой налог» live OAuth/refresh remains unverified. E-sign/Контур authoritative read status remains unverified. Twilio real round-trip remains unverified. Expo push live provider availability is not a CI fact. S3/media fail closed but ambiguous-write/orphan recovery remains #238.

## 6. Capacity and SLO

Candidate thresholds remain HTTP failure rate <1%, p95 <1000 ms, p99 <2500 ms; WebSocket delivery failure <1%, p95 <1000 ms, p99 <2500 ms. Real capacity is **NOT PROVEN** until retained smoke/ramp/spike/soak evidence exists on external production-like staging. #236.

## 7. Disaster recovery truth

Repository restore is **CI VERIFIED** via #290/run `33344103969`. Managed production backup/PITR is **NOT EXTERNALLY VERIFIED**. Targets remain RPO ≤15 min, RTO ≤60 min, PITR window ≥7 days, retention ≥35 days. #234 remains P0.

## 8. Observability truth

Repository controls exist, but end-to-end external alert delivery is **NOT VERIFIED**. #235 remains P0 until retained evidence binds one probe to ingestion, alert firing, notification, acknowledgement and recovery. Mobile crash-reporting evidence is also not retained.

## 9. Security truth

Repository CodeQL, dependency, secret and container controls exist. External blockers remain #247 P0 branch protection, #256 P1 privileged-access review, #257 P1 independent pentest and #237 P1 external security/credential evidence.

## 10. Mobile/release identity

Source identity is `0.3.7`, iOS build `3`, Android versionCode `3`. Real EAS/TestFlight/Android internal release remains `NOT EXTERNALLY VERIFIED` until exact Git SHA, native build numbers, EAS build IDs and retained evidence exist.

## 11. Current launch blockers

P0:

- #233 persistent external staging and exact-artifact promotion;
- #234 managed backup/PITR and measured real DR;
- #235 external observability/alert delivery;
- #247 enforced `main` protection/required checks.

Launch-blocking P1:

- #236 real capacity/load qualification;
- #237 external security acceptance;
- #238 provider/S3 reconciliation and recovery gaps;
- #241 controlled pilot, telemetry, legal/privacy and launch operations;
- #256 privileged-access review;
- #257 independent penetration/abuse test;
- #265 manual payment evidence lifecycle.

#266 is closed and must not reappear unless a new regression is independently demonstrated. Resolved #273 and #279 likewise stay out of the blocker list.

## 12. Broad-production decision

Current decision: **BLOCKED_FOR_BROAD_PRODUCTION**.

The next product-integrity sequence is:

1. #265 manual payment evidence lifecycle;
2. #238 provider/S3 recovery;
3. #235/#283 observability and real alert evidence;
4. persistent external staging #233;
5. load #236;
6. managed DR #234;
7. branch protection #247 + privileged access #256;
8. independent pentest #257;
9. exact mobile release artifacts;
10. controlled pilot #241;
11. final full-system red-team and readiness freeze.

The status may become `READY_FOR_BROAD_PRODUCTION` only when all P0 and launch-blocking P1 items are closed with evidence at the correct verification level.
