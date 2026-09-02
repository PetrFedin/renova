# Renova — Production Readiness

**Broad production launch:** **BLOCKED_FOR_BROAD_PRODUCTION**  
**Machine-readable source of truth:** `docs/production-readiness-evidence.json`  
**SHA-bound evidence:** GitHub Actions artifact `production-readiness-snapshot` from `Production readiness integrity`.

This document is the human-readable companion to the machine manifest. It records only current repository truth and explicitly separates repository/CI evidence from external staging, provider, production and operator evidence.

## 1. Current repository facts

The evaluated Git SHA is supplied by CI and is not hard-coded into this file. `scripts/production_readiness.py` resolves the exact evaluated SHA, live `main`, current Alembic graph head, mobile source identity and live blocker issue state on every readiness run.

| Fact | Current value |
|---|---:|
| Alembic head | `w18nativeenumparity01` |
| Mobile version | `0.3.7` |
| iOS buildNumber | `3` |
| Android versionCode | `3` |
| Backend artifact contract | `ghcr.io/petrfedin/renova-api:sha-${GIT_SHA}` |
| Runtime roles | `renova-api` + `renova-worker` from one immutable image |

## 2. What repository CI currently proves

Current repository gates prove, for the exact candidate they evaluate:

- full backend regression plus PostgreSQL Alembic upgrade;
- API/UI Playwright E2E;
- canonical local PostgreSQL + Redis + MinIO + API + Worker topology;
- fail-fast runtime validation, health/readiness and worker heartbeat;
- current schema/ORM parity through `w18nativeenumparity01`;
- DomainOutbox retry/lease/DLQ/operator recovery contracts;
- provider reconciliation foundations for payments/receipts/push and related workers;
- OTP/session, RBAC/object authorization and WebSocket security contracts;
- CodeQL, dependency integrity, Gitleaks/container security and non-root image contracts;
- logical PostgreSQL backup/isolated restore/application-start regression;
- exact Python 3.12.13 + Poetry 2.4.1 locked backend toolchain;
- living technical specification integrity.

A green repository gate is **CI VERIFIED** only. It does not by itself prove external staging, production deployment, real provider liveness, managed backup restore, alert delivery, mobile-store release or real capacity.

## 3. Current product-integrity state

### DONE / CI VERIFIED

**Canonical development runtime — PR #288.** The production-topology local developer environment is merged: PostgreSQL + Redis + MinIO + API + Worker, fail-fast Alembic, explicit seed and readiness/heartbeat checks. Exact successor head: `46fb8aaf52c33449b3a168ee226c605a94c0d3d4`; merge: `7bd1dceb273a7e1f26ddf2333e9199d8d498ae54`.

**Repository DR regression — PR #290.** Exact head `a85528303f6e6704ac8a0feaa6845e7ddfc9c93a`, `Database restore integrity` run `33344103969`, merge `748ed5f22db0bfe18001f276ec521d0198d4dc57`. The repository proves current-head fixture creation → `pg_dump` → isolated restore → schema/fingerprint verification → real ASGI lifespan against the restored DB with demo/create-all disabled → `/health` + `/ready` → post-start fingerprint. This is not a managed-provider production restore.

**Chat read truth — PR #270.** Explicit authoritative read cursor, side-effect-free reads, monotonic read-state reconciliation and mobile visibility-gated read behaviour are merged. Equal-timestamp cursor precision remains non-launch-blocking P2 #271.

**Phone chat invitation delivery — PR #277.** Durable invitation intent, DomainOutbox delivery, provider ambiguity fencing, thread-scoped ACL/inbox/WS and truthful mobile delivery state are merged. Real Twilio staging/provider round-trip remains externally unverified.

**Incoming chat atomicity/idempotency — PR #292.** Exact head `ca0be7ba75949879b538ef654ac36869ce0a3f96`, merge `9d3f96bad6138aef7f7db32407162fe07897572d`. Stable `client_request_id`, `ClientWriteRequest` replay/conflict, PostgreSQL concurrent same-key collapse, atomic message + recipient visibility + DomainOutbox, server-authoritative capabilities and mobile reconciliation are merged. External S3 ambiguous-write/orphan recovery remains #238.

### ACTIVE / INCOMPLETE

**Warranty create idempotency — #266.** Warranty exists as a product flow, but current `main` still needs the current-head atomic/idempotent create successor: stable request identity, one transaction for Issue + warranty Document + idempotency ledger + activity/notification outbox, PostgreSQL concurrency collapse, mobile retry identity and closeout regression. Stale PR #287 is reference lineage only.

**Manual payment evidence — #265.** `paid_unverified` exists, but the full evidence upload/version → authorized approve/reject → safe resubmit → exactly-once financial recognition lifecycle is not yet complete. No direct `Project.budget_spent` mutation may be added outside canonical finance recognition.

**Provider/S3 recovery — #238.** Several provider reconciliation foundations exist, but external authoritative read/recovery gaps and S3 ambiguous-write/orphan recovery are not closed.

## 4. External environment truth

| Environment | Status | Truth |
|---|---|---|
| Isolated CI staging | `CI VERIFIED` | Repository topology/contracts execute successfully on exact candidates. |
| Persistent external production-like staging | `NOT EXTERNALLY VERIFIED` | No retained authoritative evidence of current exact digest deployed with real TLS/DNS/managed dependencies/provider sandbox. Tracking #233. |
| Production | `NOT EXTERNALLY VERIFIED` | No retained exact deployed Git SHA + image digest + runtime evidence. |

Broad production remains blocked until build-once/promote-the-same-digest is demonstrated against a persistent external staging and then production.

## 5. Provider truth

- YooKassa: repository durable reconciliation exists; live credentials/liveness/rotation are not externally verified.
- FNS receipts: repository retry/reconciliation exists; live provider liveness is not externally verified.
- «Мой налог»: credential lifecycle hardening exists; live OAuth/provider refresh contract remains unverified.
- e-sign/Контур: durable submit/webhook foundations exist; configured authoritative read-status contract remains unverified.
- Twilio: durable outbox and ambiguous-write fencing are CI verified; real provider round-trip is not externally verified.
- Expo push: delivery/receipt reconciliation exists; live provider availability is not a CI fact.
- S3/media: configuration/runtime fail closed, but ambiguous-write/orphan recovery remains open under #238.

## 6. Capacity and SLO

Repository load contracts exist and candidate thresholds remain:

- HTTP failure rate < 1%;
- HTTP p95 < 1000 ms;
- HTTP p99 < 2500 ms;
- WebSocket delivery failure rate < 1%;
- WebSocket p95 < 1000 ms;
- WebSocket p99 < 2500 ms.

Real capacity is **NOT PROVEN** until protected smoke/ramp/spike/soak scenarios run against external production-like staging on the exact Git SHA/image digest and retained evidence includes DB/Redis/worker/outbox pressure and recovery. Tracking #236.

## 7. Disaster recovery truth

Repository restore is **CI VERIFIED** via #290/run `33344103969`.

Managed production backup/PITR is still **NOT EXTERNALLY VERIFIED**. Launch targets remain:

- RPO ≤ 15 minutes;
- RTO ≤ 60 minutes;
- PITR window ≥ 7 days;
- backup retention ≥ 35 days.

#234 remains P0 until a real isolated restore from a managed production-like backup records requested/recovered point, measured data loss, DB-ready time, application health/readiness and final RPO/RTO.

## 8. Observability truth

Repository observability controls are present, but end-to-end external alert delivery is **NOT VERIFIED**. #235 remains P0 until retained staging evidence binds one probe ID to error/log/trace/metric ingestion, alert firing, notification delivery, human acknowledgement and recovery. Mobile crash-reporting evidence is also not yet retained.

## 9. Security truth

Repository-side CodeQL, dependency, secret and container controls exist. Accepted security risks in the readiness manifest are currently empty.

External launch blockers remain:

- #247 P0 — enforce and negatively verify `main` branch protection/required checks;
- #256 P1 — real GitHub/org privileged-access review;
- #257 P1 — independent pre-launch penetration/abuse test;
- #237 P1 — remaining external security acceptance/credential rotation evidence.

A green repository security scan does not close these external controls.

## 10. Mobile/release identity

Source identity is version `0.3.7`, iOS build `3`, Android versionCode `3`. A real EAS/TestFlight/Android internal release remains `NOT EXTERNALLY VERIFIED` until exact Git SHA, native build numbers, EAS build IDs and retained release evidence exist. Source `app.json` is not store-release evidence.

## 11. Current launch blockers

P0:

- #233 persistent external staging and exact-artifact promotion;
- #234 managed backup/PITR and measured real DR;
- #235 external observability/alert delivery;
- #247 enforced `main` protection/required checks.

Launch-blocking P1 currently retained:

- #236 real capacity/load qualification;
- #237 external security acceptance;
- #238 provider/S3 reconciliation and recovery gaps;
- #241 controlled pilot, telemetry, legal/privacy and launch operations;
- #256 privileged-access review;
- #257 independent penetration/abuse test;
- #265 manual payment evidence lifecycle;
- #266 warranty create atomicity/idempotency.

Resolved #273 and #279 must not reappear in the blocker list unless a new regression is independently demonstrated.

## 12. Broad-production decision

Current decision: **BLOCKED_FOR_BROAD_PRODUCTION**.

The next product-integrity sequence is:

1. #266 warranty atomicity/idempotency current-head successor;
2. #265 manual payment evidence lifecycle;
3. #238 provider/S3 recovery;
4. #235/#283 observability and real alert evidence;
5. external staging → load → managed DR → security governance → exact mobile release → controlled pilot → final red-team/readiness freeze.

The status may become `READY_FOR_BROAD_PRODUCTION` only when all P0 and launch-blocking P1 items are closed with evidence at the correct verification level.
