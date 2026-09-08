# Renova — Production Readiness

**Broad production launch:** **BLOCKED_FOR_BROAD_PRODUCTION**  
**Machine-readable source of truth:** `docs/production-readiness-evidence.json`  
**SHA-bound evidence:** GitHub Actions artifact `production-readiness-snapshot` from `Production readiness integrity`.

Repository qualification is **CI VERIFIED** only for the exact candidate tested. It does not prove external staging, production deployment, provider delivery or full product acceptance. This revision reconciles the merged participant foundation and the still-open management candidate; it grants no new external readiness credit.

## 1. Current repository facts

`scripts/production_readiness.py` resolves the evaluated SHA, live main, migration graph, mobile source identity and live blocker issue states.

| Fact | Current value |
|---|---:|
| Alembic head | `w22projectparticipants01` |
| Mobile version | `0.3.7` |
| iOS buildNumber | `3` |
| Android versionCode | `3` |
| Backend artifact contract | `ghcr.io/petrfedin/renova-api:sha-${GIT_SHA}` |
| Runtime roles | `renova-api` + `renova-worker` from one immutable image |

## 2. What repository CI proves

Exact-candidate gates cover full backend regression + PostgreSQL Alembic upgrade, API/UI Playwright E2E, canonical local PostgreSQL/Redis/MinIO/API/Worker topology, health/readiness/heartbeat, schema/ORM parity, DomainOutbox retry/lease/DLQ recovery, provider reconciliation foundations, auth/RBAC/object ACL/WebSocket security, CodeQL/dependency/Gitleaks/container security, repository backup/isolated restore, locked toolchain and living technical-spec integrity.

Material provenance and participant foundation have dedicated physical predecessor-schema upgrade/backfill/CHECK tests. Participant concurrency is tested against PostgreSQL, not inferred from SQLite. A changed candidate requires fresh qualification; earlier green runs are historical evidence.

## 3. Product-integrity state

### Merged / bounded repository evidence

- Canonical development runtime: #288, qualified successor `46fb8aaf52c33449b3a168ee226c605a94c0d3d4`, merge `7bd1dceb273a7e1f26ddf2333e9199d8d498ae54`.
- Repository DR regression: #290, run `33344103969`, merge `748ed5f22db0bfe18001f276ec521d0198d4dc57`; not managed-provider production restore.
- Chat read truth: #270. Equal-timestamp precision remains #271. Phone invitation delivery foundation: #277; real Twilio round-trip remains externally unverified.
- Incoming chat atomicity: #292, merge `9d3f96bad6138aef7f7db32407162fe07897572d`; external S3 recovery remains #238.
- Warranty atomicity: #295, qualified head `22dd1f2d379f3d2f26278b58b03a1ca4f022da3c`, merge `9fed24c1b59d767daef4d6395fd01cb303c838e3`; #266 closed.
- Manual payment evidence: #297, qualified head `7983b0dfecc3dd799ec8e498680bdfaa0141fc4b`, merge `389f35d819dbf0b81d2e821da851fa9a647705d2`; #265 closed. Private versioned evidence/review and one Payment → Expense recognition are bounded repository facts.
- Explicit stage start: #309. Material readiness does not manufacture a start fact.
- Material supply truth: #310 / `w20materialsupply01`.
- Material price provenance: #311, merge `85f8d279d393b42bae5d76fea333f9d13c8ae0b5`, `w21materialprice01`. Historical unknown prices remain quarantined rather than invented.
- Participant foundation: #312, qualified head `7bb6fc9d2f0a86539355e17f0af8e7f43e896534`, merge `38657631348ea7bbe9a22cd5d631cb4ddba0250e`, `w22projectparticipants01`. This is not complete multi-contractor product support.

### Active / incomplete

**Participant management candidate #313 / tracking #300.** Adds canonical HTTP lead synchronization and owner-managed participant API. The 2026-09-08 hardening candidate refreshes locked ORM state, revalidates authorization, safely reactivates former leads and makes marketplace conversion one transaction with date-stable replay. Previous head `3c9d527578873111826e8e5e0253f46ddf7e4ec4` passed CI; the changed head must independently qualify before merge. See `docs/technical-spec/PROJECT-PARTICIPANT-SCOPE-CONTRACT.md` for implementation, test contracts and named blockers.

**#300 remains OPEN.** It was reopened on 2026-09-08 because its full acceptance criteria are not satisfied. Independent participants still lack scoped project discovery/mobile UX, domain execution/commercial/document/chat adoption and a customer + 2–3 contractor golden path. Generic project ACL intentionally remains closed. Legacy writer retirement, contractor-wide quota serialization and marketplace source-transition fencing are explicitly retained engineering work.

**#238:** provider/S3 authoritative recovery, ambiguous-write/orphan reconciliation remain open. **#305:** role/design-system completion is separate from participant authorization.

## 4. External environment truth

| Environment | Status | Evidence boundary |
|---|---|---|
| Isolated CI staging | CI VERIFIED on qualified candidates | Repository topology/contracts only. |
| Persistent external staging | NOT EXTERNALLY VERIFIED | No retained exact-digest TLS/DNS/managed-dependency/provider evidence; #233. |
| Production | NOT EXTERNALLY VERIFIED | No retained exact deployed Git SHA + digest + runtime evidence. |

## 5. Provider truth

Live YooKassa/FNS credentials and liveness, Мой налог OAuth/refresh, Контур/e-sign authoritative reads, Twilio round-trip and Expo push availability are not proved by CI. S3 ambiguous-write/orphan recovery remains #238. Local/mock provider success must not be presented as external delivery.

## 6. Capacity and SLO

Candidate targets remain HTTP failure rate <1%, p95 <1000 ms, p99 <2500 ms; WebSocket delivery failure <1%, p95 <1000 ms, p99 <2500 ms. Real capacity is NOT PROVEN until authenticated smoke/ramp/spike/soak evidence is retained on external production-like staging (#236).

## 7. Disaster recovery truth

Repository restore is CI VERIFIED via #290/run `33344103969`. Managed production backup/PITR is NOT EXTERNALLY VERIFIED. Targets remain RPO ≤15 min, RTO ≤60 min, PITR window ≥7 days and retention ≥35 days. #234 remains P0.

## 8. Observability truth

External ingestion → alert firing → notification → acknowledgement → recovery is NOT VERIFIED. #235 remains P0. Mobile crash-report evidence is not retained. Draft #283 contains a probe/evidence mechanism, not proof of external alert delivery.

## 9. Security truth

Repository CodeQL, dependency, secret and container controls exist. External blockers remain #247 P0 main protection, #256 P1 privileged-access review, #257 P1 independent pentest and #237 P1 external security/credential evidence. Repository code does not enforce GitHub settings merely by describing them.

## 10. Mobile/release identity

Source identity is `0.3.7`, iOS `3`, Android `3`. EAS/TestFlight/Android internal release remains NOT EXTERNALLY VERIFIED without exact Git SHA, native build numbers, EAS build IDs and retained release evidence.

## 11. Current launch blockers

P0: #233 external staging/artifact promotion; #234 managed backup/PITR/DR; #235 external observability; #247 enforced main protection/required checks.

Launch-blocking P1 in machine-readable readiness: #236 capacity, #237 external security, #238 provider/S3 recovery, #241 pilot/telemetry/legal/privacy/operations, #256 privileged access and #257 independent pentest.

#265/#266 are closed and must not be reintroduced without evidence of regression. The participant product-model issue #300 remains open independently of the existing external launch-blocker list. Its acceptance cannot be replaced by a green management API suite.

## 12. Broad-production decision

**BLOCKED_FOR_BROAD_PRODUCTION** remains unchanged.

Next repository gate: exact-head qualification of #313, then bounded retirement of retained legacy writers/capacity/source-transition gaps and scoped participant/mobile/domain adoption under #300. Preserve #238 recovery and #283/#235 observability as separate ownership slices. External staging #233, capacity #236, DR #234, main protection #247, privileged access #256, pentest #257, security #237 and controlled pilot #241 still require their own retained evidence.
