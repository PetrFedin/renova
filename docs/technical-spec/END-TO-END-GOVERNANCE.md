# Renova — mandatory end-to-end specification governance

**Status:** ACTIVE / AUTHORITATIVE ANNEX
**Parent dossier:** `docs/RENOVA-TECHNICAL-SPECIFICATION.md`
**Effective from:** 2026-08-29. **Current reconciliation:** 2026-09-08.

This is mandatory specification governance, not optional process guidance. The prior full version is retained in `history/END-TO-END-GOVERNANCE-before-2026-09-08.md`; its old ordered next-step list is historical.

## 1. Same-change specification rule

Every change to behavior, architecture, data, API, migrations, runtime, background work, security/ACL, UX, calculations, providers, recovery, CI/release gates or evidence must update the living specification or its relevant governed annex in the same logical change. Green code with stale specification is incomplete.

## 2. Mandatory gap scan

Trace the whole affected path before editing: dead ends; broken entity/event/screen links; duplicate routes/calculations/state machines; stale legacy writers; missing transaction/idempotency/concurrency; missing loading/empty/error/stale/retry/recovery; role/ACL mismatch; schema/ORM drift; false equivalence of local/CI/staging/production; fields without real producers/consumers; outbox ambiguity; user journeys without a terminal result; documentation describing obsolete behavior.

Confirmed P0/P1 findings must be fixed or recorded in the dossier/roadmap with a specific issue, responsible engineering role, acceptance test and evidence boundary. Do not leave them only in chat. A missing test is not automatically a missing implementation; a source-confirmed defect is not automatically a production incident.

## 3. End-to-end continuity

Where applicable:

`entry/navigation -> authorization -> input/schema -> service -> transaction -> authoritative DB -> outbox/provider -> reconciliation -> API read model -> UI/file outcome -> retry/recovery -> audit/evidence`.

The unit of acceptance is a user's complete business result, including failure paths. Neither an isolated API nor a visible button completes it. Planned capability must not be removed or called complete merely because a safe unavailable state exists.

## 4. Canonical authority

Navigation: registry+router. Data: ORM+linear migrations+PostgreSQL. Money: explicit source/recognition ledger. Background: DomainOutbox+worker. Readiness: root readiness Markdown+JSON. Engineering: AGENTS. Product contract: current master+governed annexes.

Historical snapshots are preserved for traceability, not used as current readiness or current migration headers. Source hashes bind what was inspected; they do not prove functional correctness. Current master schema header, readiness header/JSON and actual graph must agree. A head mentioned elsewhere or a permanent PENDING REVERIFY is not a substitute.

## 5. Merge gate

Before merging verify same-change spec, recorded gaps, one authority per concept, complete affected chain, negative/replay/concurrency tests, applicable exact-candidate CI, truthful external-not-verified boundaries and current blocker state. Preserve review gates and do not bypass main protection. Do not change unrelated feature ownership while refreshing a stale PR.

### 5.1 Draft-transition recovery

A tooling failure does not permit direct push to main. If tooling cannot change a qualified Draft to Ready: record the blocker, keep the old Draft open until a bounded successor exists, branch from the qualified lineage, open a non-draft successor to the same base, obtain fresh exact-head qualification, merge only the qualified successor, then mark the old Draft superseded with evidence links. No stale-CI reuse or unrelated scope increase.

## 6. Post-merge reconciliation

Close only issues whose full acceptance is satisfied on main. Update readiness only for actual evidence changes. Refresh dependent PRs from canonical main and requalify after changes. A foundation merge does not close a cross-domain product issue. An old workflow result remains evidence for its exact candidate, not a new universal certificate.

## 7. Current ordered integration state

- #288 local runtime foundation and #289 documentation reconciliation are merged.
- #290 repository logical restore is merged; managed PITR/DR remains #234.
- #292 ordinary incoming chat atomicity is merged; task/invoice/offline replay remain #316/#317 and external storage #238.
- #295 warranty creation and #297 manual evidence are merged; do not treat #287 or #265 as unfinished merely from old documents.
- #309/#310 material/start truth, #311 price provenance and #312 participant foundation are merged.
- #313 participant management/atomic marketplace conversion merged as65ddb7e59e6bcb23473b1017686cd3adbd882187 after qualification ofae8a0750bb6cc788c9e93a1f85a7355f3b180380.
- #314 mobile quoted-lead wizard recovery merged as95dd4a8e117289df11e1300891490768c22f585f after qualification of6e88a1d15883964b1c3f4f0a0f203fb6ef2f0817.
- #300 remains OPEN for full independent-contractor scoped domains/mobile/E2E, not merely its foundation.

Current product priorities from the source audit: #316 and #315; then safe transport/cache #317, analytics #318, purge lifecycle #319, native exports #320 and truthful interactions #305; then bounded #300 adoption. Follow `CHANGELOG-ROADMAP.md` and `PRODUCT-COMPLETENESS-AUDIT-2026-09-08.md` for acceptance and ownership.

External main protection/staging #247/#233, observability #235/#283, managed DR #234, capacity #236, provider recovery #238, security #256/#257/#237 and pilot #241 retain independent evidence requirements and may progress in parallel.

#282/#284/#286/#287 are historical implementation/process lineage, not PRs to merge again. #283 is a separate stale draft to refresh; an emission probe cannot prove external alert delivery.

## 8. Product-wide acceptance evidence

G01–G10 in the full audit cover standalone repair, single contractor, independent contractors, unstable network, account changes, financial reconciliation, documents, handover/lifecycle, incidents and device/accessibility. Register requirement→entry/role→service/entity→test→run/artifact. Clearly label source-only inspection, bounded CI, new execution and external verification. A static screen inventory must not be reported as execution of every action.

## 9. Current execution boundary

Owner direction: core completion first; do not connect YooKassa or other external providers yet. Preserve adapter/outbox/reconciliation architecture and fail-closed unavailable states. External execution is deferred, not verified or removed from eventual acceptance. The initial #316 slice is governed by `CHAT-BUSINESS-COMMAND-CONTRACT.md`; no full-issue closure from partial command hardening.
