# Renova — Production Readiness

**Broad production launch:** **BLOCKED_FOR_BROAD_PRODUCTION**
**Observed on:** 2026-09-08. **Audited product SHA:** `95dd4a8e117289df11e1300891490768c22f585f`.
**Machine-readable source:** `docs/production-readiness-evidence.json`.
**Full product audit:** `docs/technical-spec/PRODUCT-COMPLETENESS-AUDIT-2026-09-08.md`.

This is a product AND external-operations decision. Architecture and a green bounded PR do not make every user outcome production-ready. This audit records source-confirmed defects; it does not assert new full runtime/device/external qualification.

## 1. Repository facts

| Fact | Current value |
|---|---|
| Alembic head | `w22projectparticipants01` |
| Mobile source version | `0.3.7` |
| iOS buildNumber / Android versionCode | `3` / `3` |
| Backend image | `ghcr.io/petrfedin/renova-api:sha-${GIT_SHA}` |
| Runtime | `renova-api` + `renova-worker`, one immutable image |

CI supplies the evaluated SHA. `scripts/production_readiness.py` derives migration/mobile facts and live main/blocker states. A source build number is not an EAS/TestFlight/store release.

## 2. Merged, bounded implementation evidence

- #288 canonical local runtime/agent workflow, merge `7bd1dceb273a7e1f26ddf2333e9199d8d498ae54`.
- #290 isolated logical restore, run `33344103969`, merge `748ed5f22db0bfe18001f276ec521d0198d4dc57`; not managed production backup/PITR.
- #270 chat read cursor; #277 invitation outbox; #292 incoming message atomicity, merge `9d3f96bad6138aef7f7db32407162fe07897572d`. Equal timestamps #271 and other chat business actions are separate.
- #295 warranty creation, qualified head `22dd1f2d379f3d2f26278b58b03a1ca4f022da3c`, merge `9fed24c1b59d767daef4d6395fd01cb303c838e3`; #266 closed.
- #297 manual payment evidence, qualified head `7983b0dfecc3dd799ec8e498680bdfaa0141fc4b`, merge `389f35d819dbf0b81d2e821da851fa9a647705d2`; #265 closed. One confirmed Payment→Expense in that bounded flow is already implemented/qualified.
- #309 explicit work start; #310 quantity-aware material supply, w20; #311 price provenance/quarantine, merge `85f8d279d393b42bae5d76fea333f9d13c8ae0b5`, w21.
- #312 participant foundation, merge `38657631348ea7bbe9a22cd5d631cb4ddba0250e`, w22; not complete multi-contractor support.
- #313 participant management/atomic lead conversion is MERGED, not still a candidate. Qualified head `ae8a0750bb6cc788c9e93a1f85a7355f3b180380`, full CI `34262996030`, participant PostgreSQL `34262996112`, merge `65ddb7e59e6bcb23473b1017686cd3adbd882187`. 35 focused tests included genuine two-session PostgreSQL races; not all fixtures were PostgreSQL-only.
- #314 quoted-lead wizard recovery is MERGED. Qualified head `6e88a1d15883964b1c3f4f0a0f203fb6ef2f0817`, CI `34264654118`, merge `95dd4a8e117289df11e1300891490768c22f585f`. General Playwright passed; a new dedicated native wizard scenario was not proved.

Previous implementation runs are retained historical evidence for their exact code. An updated candidate requires fresh applicable qualification. Neither a master-document rewrite nor a static inventory upgrades implementation evidence.

## 3. Source-confirmed product blockers

| Issue | Priority | Remaining user-result gap |
|---|---|---|
| #316 | P0 | Queued chat invoice/task and direct WorkOrder create lack a complete first-attempt idempotency/atomicity chain; lost-response retry can duplicate operations. |
| #315 | P1 launch-blocking | Global context/token/queue work is not fenced across session changes; queue owner may differ from current Bearer. Server ACL still applies; no universal bypass claimed. |
| #317 | P1 | Normalized ApiError0 prevents intended enqueue in some producers; layered cache can mislabel stale results fresh. |
| #318 | P1 | Monthly plan buckets can total125%; portfolio category actuals are not independent measured facts. This is not an asserted corruption of server spend. |
| #319 | P1 | Project purge/empty-trash does not cover the new participant/evidence graph and explicit retention outcome. |
| #320 | P1 | Reachable chat PDF action lacks native file/save/share completion. |
| #300 | P1 | Scoped independent-contractor domain/mobile/payee/document/chat journey remains incomplete despite foundation+management. |
| #305 | P1 correctness subset | Commit success can be shown as failure after refresh; complete role/error/recovery/accessibility interaction is unfinished. |

These findings require tests of real consumers and failure boundaries. Existing #265/#266/#299 must not be reopened merely because unrelated operations have defects. Full audit G01–G10 defines the remaining end-to-end acceptance target without reducing scope to an MVP.

## 4. External environment and providers

Persistent external staging and production: **NOT EXTERNALLY VERIFIED**. Absence of retained evidence is not proof the environment literally does not exist. #233 requires exact deployed SHA/digest, TLS/DNS, managed dependencies and promotion evidence.

Live YooKassa, FNS/НПД, Контур, SMS and push delivery/liveness/recovery are not proved by repository CI. S3 ambiguous-write/orphan recovery remains #238. Goskey is explicitly unavailable in the inspected code; document metadata classification is not content OCR. Planned optional-provider/release-scope decisions must be explicit; disabled capability is not completed functionality.

## 5. Capacity, DR and observability

Candidate targets: HTTP failure rate<1%, p95<1000ms/p99<2500ms; WebSocket delivery failure<1%, p95<1000ms/p99<2500ms. Real authenticated smoke/ramp/spike/soak evidence remains #236; no measured production capacity asserted.

Repository logical restore is bounded CI evidence (#290). Managed production backup/PITR remains #234. Targets RPO≤15min, RTO≤60min, PITR window≥7days, retention≥35days are not measured achievements.

External ingestion→alert→delivery→ACK→recovery remains #235. Old draft #283 is a probe implementation, not evidence of actual alert delivery. Mobile crash reporting and operator response also require retained evidence.

## 6. Security and release

Repository CodeQL/dependency/secret/container controls exist. #247 enforced main protection, #256 privileged-access review, #257 independent penetration/abuse test and #237 external security/credential acceptance remain open. Do not describe controls as nonexistent, or externally verified from CI.

Canonical mobile typecheck currently accepts named JSX diagnostics; dependency policy has bounded advisories. Green means those configured gates passed, not clean raw tsc/zero vulnerabilities. `docs/js-dependency-security.md` and source baselines are the policy reference; no new risk acceptance is granted by this audit.

Actual EAS/TestFlight/Android release remains NOT EXTERNALLY VERIFIED without exact build IDs and retained delivery evidence. Pilot/telemetry/legal/privacy/support operations remain #241.

## 7. Ordered continuation

Product: #316 + #315 → safe offline/error/cache #317 → analytics/lifecycle/native/interaction #318/#319/#320/#305 → full scoped #300. Provider recovery #238 is a separate functional stream.

In parallel: main protection #247 and external staging #233; then real alert/DR/capacity/security/pilot evidence with their own dependencies. Do not impose a fictitious single serial chain or a launch ETA without resource/external access evidence.

The next admissible production decision requires the complete declared product result and external operational gates on one release candidate. Current decision remains **BLOCKED_FOR_BROAD_PRODUCTION**.

## Current owner-directed stage

Core completion without connecting YooKassa or other external providers. External activation/evidence is deferred, not completed. Preserve all eventual production acceptance requirements. The bounded chat invoice/task slice is IMPLEMENTED / EXACT-HEAD CI REQUIRED; see `docs/technical-spec/CHAT-BUSINESS-COMMAND-CONTRACT.md`. #316 and #315 remain open.
