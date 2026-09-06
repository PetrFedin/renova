# Renova — Production Readiness

**Broad production launch:** **BLOCKED_FOR_BROAD_PRODUCTION**  
**Machine-readable source of truth:** `docs/production-readiness-evidence.json`  
**SHA-bound evidence:** GitHub Actions artifact `production-readiness-snapshot` from `Production readiness integrity`.

This document records current repository truth and separates repository/CI evidence from external staging, provider, production and operator evidence. A green repository gate is **CI VERIFIED** only; it is not proof of external production behavior.

## 1. Current repository facts

The evaluated Git SHA is supplied by CI. `scripts/production_readiness.py` resolves the exact evaluated SHA, live `main`, current Alembic graph head, mobile source identity and live blocker issue state.

| Fact | Current value |
|---|---:|
| Alembic head | `w21materialprice01` |
| Mobile version | `0.3.7` |
| iOS buildNumber | `3` |
| Android versionCode | `3` |
| Backend artifact contract | `ghcr.io/petrfedin/renova-api:sha-${GIT_SHA}` |
| Runtime roles | `renova-api` + `renova-worker` from one immutable image |

## 2. What repository CI currently proves

Current exact-candidate gates cover full backend regression + PostgreSQL Alembic upgrade, API/UI Playwright E2E, canonical local PostgreSQL/Redis/MinIO/API/Worker topology, health/readiness/heartbeat, schema/ORM parity, DomainOutbox retry/lease/DLQ recovery, provider reconciliation foundations, auth/RBAC/object ACL/WebSocket security, CodeQL/dependency/Gitleaks/container security, repository backup/isolated restore, exact locked backend toolchain and living technical-spec integrity.

For material price truth there is also a dedicated real PostgreSQL predecessor-schema gate: migrate to `w20materialsupply01` → create historical rows using only the physical w20 schema → upgrade to `w21materialprice01` → prove fail-closed backfill/CHECK behavior → run focused price provenance contracts.

Repository evidence does **not** prove persistent external staging, exact production deployment, live provider liveness, managed backup/PITR restore, external alert delivery, store release or real capacity.

## 3. Product-integrity state

### DONE / CI VERIFIED

**Canonical development runtime — PR #288.** Exact successor head `46fb8aaf52c33449b3a168ee226c605a94c0d3d4`; merge `7bd1dceb273a7e1f26ddf2333e9199d8d498ae54`.

**Repository DR regression — PR #290.** Head `a85528303f6e6704ac8a0feaa6845e7ddfc9c93a`, `Database restore integrity` run `33344103969`, merge `748ed5f22db0bfe18001f276ec521d0198d4dc57`. This is not a managed-provider production restore.

**Chat read truth — PR #270.** Authoritative read cursor, side-effect-free reads, monotonic read-state reconciliation and mobile visibility-gated read behaviour are merged. Equal-timestamp precision remains P2 #271.

**Phone chat invitation delivery — PR #277.** Durable invitation intent, DomainOutbox delivery, provider ambiguity fencing, thread ACL/inbox/WS and truthful mobile delivery state are merged. Real Twilio round-trip remains externally unverified.

**Incoming chat atomicity/idempotency — PR #292.** Head `ca0be7ba75949879b538ef654ac36869ce0a3f96`, merge `9d3f96bad6138aef7f7db32407162fe07897572d`. S3 ambiguous-write/orphan recovery remains #238.

**Warranty create atomicity/idempotency — PR #295 / #266 CLOSED.** Exact qualified head `22dd1f2d379f3d2f26278b58b03a1ca4f022da3c`; merge `9fed24c1b59d767daef4d6395fd01cb303c838e3`. Dedicated PostgreSQL race and full CI are green. External S3/provider recovery remains #238.

**Manual payment evidence — PR #297 / #265 CLOSED.** Exact qualified head `7983b0dfecc3dd799ec8e498680bdfaa0141fc4b`; merge `389f35d819dbf0b81d2e821da851fa9a647705d2`. Versioned private evidence, `paid_unverified` review truth, reject/resubmit, concurrency-safe review and exactly one canonical `Payment → Expense` recognition were qualified with full CI and dedicated PostgreSQL races. External S3/provider reconciliation remains #238.

**Stage explicit start after material readiness — PR #309.** Material/dependency readiness no longer manufactures a work-start fact; explicit start remains the execution authority.

**Material supply truth — PR #310.** Alembic `w20materialsupply01`; supply source, available quantity, quantity-aware readiness, purchase responsibility and durable audit are merged on `main`.

**Material price truth — #299 / PR #311 candidate.** Implementation head `3d9a087c27469e87ce04c800dc7336ae580d984d` is exact-head CI VERIFIED: full CI run `34041624593`, dedicated PostgreSQL price run `34041621417`, schema run `34041624526`, CodeQL `34041624579`, Security operations `34041624644`, technical-spec `34041624564`, readiness `34041624635` and canonical local runtime `34041624590` are green. `w21materialprice01` persists explicit price provenance, quarantines all historical positive values as `legacy_unknown`, keeps estimate/approved-selection/live/manual semantics distinct, removes the dormant synthetic `1000.0` route, makes Purchase fail closed for unknown provenance and exposes mobile remediation. This readiness synchronization changes the PR head and therefore must itself re-qualify before merge; the earlier green implementation SHA is retained evidence, not a substitute for final-head CI.

### ACTIVE / INCOMPLETE

**Provider/S3 recovery — #238.** External authoritative read/recovery gaps and S3 ambiguous-write/orphan recovery remain open.

**Multiple independent contractors — #300.** Current product truth still has one global `Project.contractor_id`; unrelated independent contractors cannot safely receive project-scoped stage/work/material/commercial access without misrepresenting ownership or widening ACLs. This is a cross-domain product-model gap, not a UI-only change, and requires participant/scope architecture plus finance/document/chat isolation.

**Role/design-system completion — #305.** Customer/contractor experience continues to be consolidated around shared primitives and role-aware capabilities; this is separate from the multi-contractor authorization model.

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

Repository controls exist, but end-to-end external alert delivery is **NOT VERIFIED**. #235 remains P0 until retained evidence binds one probe to ingestion, alert firing, notification, acknowledgement and recovery. Mobile crash-reporting evidence is also not retained. Draft PR #283 provides the staging probe/evidence mechanism but is not external alert proof by itself.

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

Launch-blocking P1 currently recorded in machine-readable readiness:

- #236 real capacity/load qualification;
- #237 external security acceptance;
- #238 provider/S3 reconciliation and recovery gaps;
- #241 controlled pilot, telemetry, legal/privacy and launch operations;
- #256 privileged-access review;
- #257 independent penetration/abuse test.

#265 and #266 are closed and must not reappear as blockers unless an independent regression is demonstrated. #299 is implementation-CI-verified and is removed from the machine-readable blocker list; merge still requires final-head requalification after this evidence synchronization.

The multi-contractor gap #300 remains an active P1 product-model issue and is the next product-integrity architecture slice; its exact launch-scope classification must be kept explicit as that contract is implemented rather than hidden inside generic role/UI work.

## 12. Broad-production decision

Current decision: **BLOCKED_FOR_BROAD_PRODUCTION**.

The next rational sequence is:

1. finish final exact-head qualification and merge #311 / close #299;
2. design and implement project-scoped multi-contractor participation/isolation #300 without weakening current lead-contractor compatibility;
3. operationalize provider/S3 recovery #238;
4. finish observability/real alert evidence #235/#283;
5. establish persistent external staging and artifact promotion #233;
6. run real authenticated capacity qualification #236;
7. prove managed backup/PITR/DR #234;
8. enforce branch protection #247 and complete privileged access review #256;
9. independent pentest #257 and external security acceptance #237;
10. exact mobile release artifacts and controlled pilot #241;
11. final full-system red-team and readiness freeze.

The status may become `READY_FOR_BROAD_PRODUCTION` only when all P0 and launch-blocking P1 items are closed with evidence at the correct verification level.
