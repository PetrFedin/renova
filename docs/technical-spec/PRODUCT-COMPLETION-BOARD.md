# RENOVA — Product Completion Board

**Status:** P0 governance / execution board  
**Tracking:** #463  
**Evidence cut:** canonical `main` = `e5c6ee44c0f684b14037e77948dbcb630fd41896` (2026-09-08)  
**Purpose:** convert the existing RENOVA capability graph into closed end-to-end lifecycles and a deterministic final integration order. This document adds no product feature, provider, route, state machine or user hub.

## 0. Completion invariant

RENOVA is PRODUCT COMPLETE only when the applicable product graph closes this lifecycle without a truth break:

`create → authoritative read → update/transition → second-side visibility → linked calculation/read-model reconciliation → cancel/business reversal → restore/reconcile → offline/response-loss safe retry → account/session isolation → closeout → historical evidence/warranty`.

A rendered screen, a reachable route, a unit test, a source inventory or an isolated PR does not by itself close that lifecycle.

### Status vocabulary — the only five readiness states

| Status | Meaning |
|---|---|
| `PROVEN` | Behavior is present on canonical `main` and exact-main evidence proves the requested lifecycle cell on the required runtime/layer. |
| `CANDIDATE PROVEN` | Exact-head PR/candidate evidence proves that bounded cell, but it is not integrated into canonical `main`. |
| `PARTIAL` | Capability exists or a subset is covered, but the requested lifecycle cell is not fully proven. |
| `BLOCKED` | A source-confirmed defect or prerequisite prevents a safe completion claim. |
| `FUTURE EXTERNAL` | Intentionally outside simulated-provider PRODUCT COMPLETE and requires later real external provider/infrastructure/native-distribution evidence. |

**Important:** open PR evidence can promote only `CANDIDATE PROVEN`, never `PROVEN`. Independent candidates are not silently composed: two green PRs on different bases do not create one green integrated product SHA.

## 1. Board normalization

The requested conceptual board is:

`M01–M12 × GP1–GP8 × mutation families × role × layer × outcome × main/candidate`.

Materializing the full Cartesian product would create thousands of meaningless non-applicable cells. The canonical board is therefore normalized into three joined tables:

1. **Mode Board** — M01–M12.
2. **Golden Path Board** — GP1–GP8.
3. **Mutation Board** — all mutating mobile API domains audited by #431: **25 business-domain modules plus the one transport/session mutation owner `client.ts` = 26 mutation surfaces**.

Each mutation row carries its applicable Modes, GPs, roles and runtime layers. Joining those keys with the Mode and GP boards yields every applicable combination without introducing an `N/A` readiness state.

Roles: `C` = customer, `K` = contractor/principal/team actor as authorized, `A` = admin/operator, `V` = viewer/portal actor.  
Layers: `UI`, `API`, `PG` (PostgreSQL), `Redis`, `MinIO`, `Worker`.

## 2. Mode Board — M01–M12

M01–M12 names come from the governed scenario model in PR #366 / #365. PR #366 is not canonical `main`, so the mode nomenclature is accepted here by #463 while its runtime readiness remains evidence-driven.

| Mode | Required closed chain | Main | Best candidate state | Product-complete gate | Primary blockers/evidence |
|---|---|---|---|---|---|
| M01 Self-managed | object → estimate → self-plan/work → materials → expenses/docs → closeout | `PARTIAL` | `PARTIAL` | `PARTIAL` | Core surfaces exist; no single API+mobile-web lifecycle proves self-managed closeout/recovery. |
| M02 One contractor | invite/lead → participant → work → acceptance → money/docs → warranty | `PARTIAL` | `PARTIAL` | `PARTIAL` | Many bounded slices exist, but no one-contractor full lifecycle on one SHA. |
| M03 Multi-contractor | independent principals → scoped execution/finance/docs/chat → aggregate customer truth | `BLOCKED` | `BLOCKED` | `BLOCKED` | #300, #344, #345; participant API client #429 is not full adoption. |
| M04 Contractor with team | principal commercial authority → subordinate execution → no payee/contract leakage | `PARTIAL` | `PARTIAL` | `PARTIAL` | Team lifecycle tests exist, but principal-vs-team product lifecycle is not closed across all domains. |
| M05 Direct invite | invite → identity/accept → participant/scope → project → work | `PARTIAL` | `PARTIAL` | `PARTIAL` | Source paths exist; complete invite failure/recovery/role lifecycle is not qualified. |
| M06 Marketplace conversion | lead → quotes → choose → atomic participant conversion → ordinary project lifecycle | `BLOCKED` | `BLOCKED` | `BLOCKED` | GP2 depends on scoped participant adoption #300/#344 and participant UX #345. |
| M07 Technical supervision | assign supervisor → inspect/evidence/issues → remediation → customer decision | `PARTIAL` | `PARTIAL` | `PARTIAL` | `technicalSupervision.ts` exists; no complete role-rights E2E proof. |
| M08 Viewer/guest | bounded read/share → revoke → stale-link denial | `PARTIAL` | `PARTIAL` | `PARTIAL` | Viewer/portal source exists; revocation/file/session lifecycle is not fully proven. |
| M09 Portal-token | bounded token → one canonical action → replay/revoke/expiry | `PARTIAL` | `PARTIAL` | `PARTIAL` | Portal decision slices exist; #448 proves a Change Order conflict slice only, not the whole portal mode. |
| M10 Closed/warranty | complete → archive/export → warranty → historical responsible principal → claim closure | `BLOCKED` | `BLOCKED` | `BLOCKED` | Permanent purge/retention graph #319; warranty/closeout not connected across roles. |
| M11 Unstable network | offline/cache → exact intent queue → response-loss replay → reconcile | `BLOCKED` | `BLOCKED` | `BLOCKED` | #316 and #317 remain open; several bounded replay candidates do not close the inventory. |
| M12 Account switch | A request/queue/cache → logout/B → no A publication/execution → A2 generation isolation | `BLOCKED` | `BLOCKED` | `BLOCKED` | #315; #428 proves only server-side logout revoke slice. |

**Mode conclusion:** no M01–M12 mode is `PROVEN` under the strict complete-lifecycle rule on current `main`; bounded candidates improve cells but do not yet close a whole mode.

## 3. Golden Path Board — GP1–GP8

`GOLDEN-PATHS.md` requires every GP in **both** API and mobile-web form on the canonical PostgreSQL + Redis + MinIO + API + Worker runtime with simulated providers. Current `main` has no canonical `e2e/golden/` / `apps/mobile/e2e/golden/` completion suite; #337/D1 #357 remain open. Therefore an isolated lifecycle PR cannot promote a GP to `PROVEN`.

| GP | Roles | Participating layers | Normal chain | Error/negative | Offline/retry | Reversal/recovery | Integrated candidate | Final GP gate | Key blockers / strongest bounded evidence |
|---|---|---|---|---|---|---|---|---|---|
| GP1 Object → rooms → estimate → budget | C, K where authority changes | UI, API, PG, Redis | `PARTIAL` | `PARTIAL` | `BLOCKED` | `PARTIAL` | `BLOCKED` | `BLOCKED` | #458 explicitly has chain verification pending; #457 estimate-line reversal is `CANDIDATE PROVEN`; #448 Change Order slice is `CANDIDATE PROVEN`; #412 response-loss create pending. |
| GP2 Marketplace → quotes → participant | C, K1, K2 | UI, API, PG, Redis, Worker | `BLOCKED` | `BLOCKED` | `PARTIAL` | `PARTIAL` | `BLOCKED` | `BLOCKED` | #300/#344/#345; #429 is API-client foundation only; A5/NPD simulator candidate #426 does not close participant scope. |
| GP3 Stages → schedule → work order → evidence/progress | C, K1, K2 negative | UI, API, PG, Redis, MinIO, Worker | `BLOCKED` | `BLOCKED` | `BLOCKED` | `PARTIAL` | `BLOCKED` | `BLOCKED` | #344 scope, #421 calendar write ACL, #451 reaction scope, #316 direct work-order/stage-comment replay, #375 media ACL. |
| GP4 Acceptance → rework → portal acceptance → warranty | C, K, V | UI, API, PG, Redis, MinIO, Worker | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `BLOCKED` | Acceptance contracts exist, but portal/rework/warranty/closeout are not one API+mobile-web proof. |
| GP5 Invoice → payment → receipt → expense → dispute/refund | C, K, A | UI, API, PG, Redis, Worker | `BLOCKED` | `BLOCKED` | `BLOCKED` | `BLOCKED` | `BLOCKED` | `BLOCKED` | A3/A4 simulated payment/port migration open; #318 finance truth; #316/#317 replay transport. #322 chat invoice command is only a bounded `CANDIDATE PROVEN` prerequisite. |
| GP6 Materials → approval → purchase → delivery → receipt/fact | C, K | UI, API, PG, Redis, Worker | `PARTIAL` | `PARTIAL` | `BLOCKED` | `PARTIAL` | `PARTIAL` | `BLOCKED` | #460 material-needs response-loss is `CANDIDATE PROVEN` on stacked lineage; #317 and full purchase/supply reversal remain. |
| GP7 Documents → version → signatures → archive/export | C, K | UI, API, PG, MinIO, Worker | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `BLOCKED` | #320 native authenticated chat-PDF/file delivery; complete version/sign/export mobile-web path absent. |
| GP8 Chat → inbox/push → read truth → reminder | C, K | UI, API, PG, Redis, MinIO, Worker | `PARTIAL` | `PARTIAL` | `BLOCKED` | `PARTIAL` | `PARTIAL` | `BLOCKED` | #316/#317/#315; #322 commands, #385 reactions and #387 intent-dedupe have bounded candidate evidence, while thread create #392 remains pending. |

**Golden Path conclusion:** no GP may be promoted until one exact integrated SHA contains the required dependencies and both API/mobile-web suites are green. PR #458 correctly does **not** promote GP1 while its connected suite remains pending.

## 4. Mutation Board — 26 mutating surfaces

`#431 / PR #432` classifies 25 business-domain API modules. Its executable scanner also sees `client.ts` as the 26th mutating module, but explicitly treats its single `/auth/refresh` POST as transport infrastructure rather than a business lifecycle. The Board preserves that distinction while still covering all 26 mutating surfaces.

Columns are intentionally lifecycle cells rather than file-existence cells:
- **Normal** = create/read/update or state transition under correct role authority.
- **Retry** = offline/response-loss/idempotent or version-fenced replay.
- **Reverse** = cancel/delete/business reversal + restore/reconcile where meaningful.
- **Linked** = second-side visibility plus canonical derived facts/read models.

| ID | Surface | Roles | Modes / GPs | Layers | Main Normal | Candidate Normal | Main Retry | Candidate Retry | Main Reverse | Candidate Reverse | Main Linked | Candidate Linked | Blocking/evidence boundary |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| F01 | `projects.ts` — project create/edit/archive/trash/restore/purge/assignment | C, K | M01–M12 / GP1–GP8 | UI, API, PG, Worker | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `BLOCKED` | `PARTIAL` | `PARTIAL` | `PARTIAL` | #434 covers reversible lifecycle as test candidate but permanent purge remains #319; assignment scope remains #300/#344. |
| F02 | `rooms.ts` — room create/edit/change request/archive/restore | C, K | M01–M03, M05–M06 / GP1, GP6 | UI, API, PG, Worker | `PARTIAL` | `PARTIAL` | `BLOCKED` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | #438 stable create/request intent and #440 lifecycle exist as candidates; #458 integration still pending. |
| F03 | `floor.ts` — floor plans/pins/furniture | C, K | M01–M03 / GP1 | UI, API, PG, MinIO | `BLOCKED` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | Cross-project binding defect #377; #380/#441 are bounded binding candidates, not full object-graph lifecycle. |
| F04 | `estimate.ts` — estimate lines, decisions, Change Orders, budget linkage | C, K | M01–M06 / GP1, GP5, GP6 | UI, API, PG, Worker | `BLOCKED` | `PARTIAL` | `BLOCKED` | `BLOCKED` | `PARTIAL` | `CANDIDATE PROVEN` | `PARTIAL` | `CANDIDATE PROVEN` | #457 proves draft line remove/restore + linked budget; #448 proves Change Order decision/conflict; #406/#412 create response-loss remains pending; #375/#444 binding must be integrated. |
| F05 | `calendar.ts` — stage dates/calendar/iCalendar | C, K | M01–M07 / GP3 | UI, API, PG, Redis, Worker | `BLOCKED` | `PARTIAL` | `BLOCKED` | `BLOCKED` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | #421 fixed by qualified candidate #424 but unmerged; iCalendar atomic replay #422/#461 evidence pending. |
| F06 | `chats.ts` — threads/messages/reactions/tasks/invoices | C, K | M02–M12 / GP5, GP8 | UI, API, PG, Redis, MinIO, Worker | `PARTIAL` | `PARTIAL` | `BLOCKED` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | #322 command replay `CANDIDATE PROVEN`; #385 reaction replay `CANDIDATE PROVEN`; #387 dedupe `CANDIDATE PROVEN`; #390/#392 thread create pending; #317 still blocks global transport truth. |
| F07 | `design.ts` — design package create/submit/approve/reject/version | C, K | M01–M05 / GP1, GP7 | UI, API, PG, MinIO, Worker | `PARTIAL` | `PARTIAL` | `BLOCKED` | `BLOCKED` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | #413/#414 create response-loss candidate has pending qualification; native file/session boundaries also depend on #315/#320. |
| F08 | `documents.ts` — documents/e-sign/version/export | C, K | M01–M10 / GP4, GP7 | UI, API, PG, MinIO, Worker | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | No complete create→version→sign→export→revoke/native lifecycle on one SHA; #320 is a confirmed native delivery gap. |
| F09 | `issues.ts` — punch/quality issue lifecycle | C, K, A where policy allows | M02–M10 / GP3, GP4 | UI, API, PG, MinIO, Worker | `PARTIAL` | `PARTIAL` | `BLOCKED` | `BLOCKED` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | #417/#418 create atomic/replay candidate not finally qualified on integrated main. |
| F10 | `market.ts` — lead/quote/select/conversion | C, K | M02–M06 / GP2 | UI, API, PG, Redis, Worker | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `BLOCKED` | `BLOCKED` | End state must create scoped participant truth; #300/#344/#345 remain open. |
| F11 | `materials.ts` — needs/picks/purchases/supply/prices | C, K | M01–M07 / GP6 | UI, API, PG, Redis, Worker | `PARTIAL` | `PARTIAL` | `BLOCKED` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | #460 proves material-needs generation response-loss on stacked lineage; broader purchase/supply/reversal and #317 remain. |
| F12 | `misc.ts` — viewers/portal/approvals/general queued actions | C, K, V | M02–M10 / GP4, GP7 | UI, API, PG, Redis, Worker | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | Contextual routes exist; bounded portal conflict in #448 does not qualify the whole surface. |
| F13 | `notifications.ts` — notification read/action/dismiss | C, K, A | M02–M12 / GP2–GP8 | UI, API, PG, Redis, Worker | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | Must reconcile with canonical source entity and session generation; #315 affects stale cross-account publication. |
| F14 | `os.ts` — workspace/profile/dashboard OS mutations | C, K | M01–M12 / GP1–GP8 | UI, API, PG, Redis | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | Read-model truth depends on finance/participant/session gates; code-only analytics remain EXPOSE_AFTER_FIX under #431. |
| F15 | `payments.ts` — payment/evidence/dispute/refund | C, K, A | M02–M12 / GP5 | UI, API, PG, Redis, Worker | `BLOCKED` | `PARTIAL` | `BLOCKED` | `PARTIAL` | `BLOCKED` | `PARTIAL` | `BLOCKED` | `PARTIAL` | A3/A4 simulated payment/port lifecycle open; #318 finance truth; #322 only proves invoice command creation and explicitly creates no Expense/provider effect. |
| F16 | `projects.ts` participant/assignment subgraph | C, K, A | M02–M07, M10–M12 / GP2, GP3 | UI, API, PG, Worker | `BLOCKED` | `BLOCKED` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `BLOCKED` | `BLOCKED` | Kept as a distinct lifecycle slice inside the same module because it is the M03/M06 authority boundary: #300/#344/#345. It does not increase the 26-module count. |
| F17 | `receipts.ts` — receipt/expense/reverify/delete | C, K, A | M01–M12 / GP5, GP6 | UI, API, PG, Redis, Worker | `PARTIAL` | `PARTIAL` | `BLOCKED` | `BLOCKED` | `PARTIAL` | `PARTIAL` | `BLOCKED` | `PARTIAL` | Stable request identity exists in parts, but reachable enqueue/cache provenance #317 and finance facts #318/#379 remain. |
| F18 | `rooms.ts` derived calc/snapshot subgraph | C, K | M01–M06 / GP1, GP6 | UI, API, PG | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | Kept explicit because room mutations must deterministically recalculate estimate/material facts; connected GP1 proof is still #458 pending. It does not increase the 26-module count. |
| F19 | `scratchpad.ts` — scratchpad create/edit/delete/promote | C, K | M01–M08 / secondary | UI, API, PG | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | Contextual capability; no connected lifecycle proof currently recorded. |
| F20 | `selections.ts` — finish/material selections and decisions | C, K | M01–M07 / GP6 | UI, API, PG, Worker | `PARTIAL` | `PARTIAL` | `BLOCKED` | `BLOCKED` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | #415/#416 create response-loss candidate remains pending qualification. |
| F21 | `stages.ts` — stages/status/comments/reactions/progress | C, K | M01–M10 / GP3, GP4 | UI, API, PG, Redis, MinIO, Worker | `BLOCKED` | `PARTIAL` | `BLOCKED` | `BLOCKED` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | Calendar child write #421, stage reaction scope #451, stage comment replay #398; #424/#452 are bounded qualified candidates, #404 remains pending. |
| F22 | `technicalSupervision.ts` — supervisor assignment/inspection/quality | C, K, A/supervisor | M07 / GP4 | UI, API, PG, MinIO, Worker | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | Role exists; no full assignment→finding→remediation→customer-decision E2E proof. |
| F23 | `workAcceptances.ts` — submit/accept/return/rework | C, K, V portal | M02–M10 / GP4 | UI, API, PG, Worker | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | Existing acceptance contracts are strong prerequisites but do not include warranty/portal/retry/full GP4 on one SHA. |
| F24 | `workOrders.ts` — work-order create/edit/transition | C, K | M01–M07 / GP3 | UI, API, PG, Redis, Worker | `PARTIAL` | `PARTIAL` | `BLOCKED` | `BLOCKED` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | Direct create response-loss remains #316/#383; candidate evidence in #383 is still pending. |
| F25 | `workSchedule.ts` — schedule/items/submit/decision | C, K | M01–M07 / GP3 | UI, API, PG, Redis, Worker | `BLOCKED` | `BLOCKED` | `BLOCKED` | `BLOCKED` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | Mutation inventory records schedule create/recovery blocker #420 plus generic #316 policy. |
| F26 | `client.ts` — transport/session refresh mutation | C, K, A | M01–M12 / all GPs | UI, API, Redis/client storage | `BLOCKED` | `PARTIAL` | `BLOCKED` | `BLOCKED` | `PARTIAL` | `CANDIDATE PROVEN` | `BLOCKED` | `BLOCKED` | `/auth/refresh` is infrastructure, not a business family. #315 blocks session-generation/A→B→A isolation; #317 blocks normalized transport/cache truth. #428 candidate proves server logout revoke only. |

### 4.1 Count clarification

The #431 contract reports 26 mutating API modules because it scans the 25 classified business modules plus `client.ts`. `client.ts` is deliberately infrastructure-owned and its only direct mutation must remain `/api/v1/auth/refresh`. The Board does **not** invent a 26th business object to make the number fit.

Rows F16 and F18 are explicit subgraphs of already-counted modules because participant scope and room-derived calculations are product-critical joins; they do not alter the module count. The canonical count remains **25 business domains + 1 transport/session mutation surface**.

## 5. Cross-cutting integrity gates

These gates dominate many cells and therefore must be retired before broad Golden Path promotion.

| Gate | Main | Candidate | Required promotion condition |
|---|---|---|---|
| Protected-main / required-check bootstrap | `BLOCKED` | `CANDIDATE PROVEN` | Owner integrate/requalify #425; separately verify live ruleset #247. |
| Backend image fixed HIGHs | `BLOCKED` | `CANDIDATE PROVEN` | Rebase/requalify #389 on resulting main; no scanner exception. |
| JS dependency fixed advisories | `BLOCKED` | `CANDIDATE PROVEN` | Rebase/requalify #372 on resulting main. |
| Required PR context scheduling | `BLOCKED` | `CANDIDATE PROVEN` | Rebase/requalify #437 after #425. |
| Canonical registry pull reliability | `PARTIAL` | `PARTIAL` | #450 exact-head qualification, then refresh onto main. |
| Session/account generation fence | `BLOCKED` | `BLOCKED` | Close #315 with delayed A→B→A, storage, navigation and queue tests. |
| Offline mutation identity/atomicity | `BLOCKED` | `PARTIAL` | Finish #316 inventory after bounded candidates; no unsafe create/toggle remains. |
| Transport enqueue + cache provenance | `BLOCKED` | `BLOCKED` | Close #317 only after mutation operations are replay-safe. |
| Participant/sibling scope isolation | `BLOCKED` | `BLOCKED` | #300 + #344 + #345; customer aggregate plus sibling negatives. |
| Finance/budget/material fact truth | `BLOCKED` | `PARTIAL` | Integrate/requalify #381 and #382 together with affected producers; no plan→fact fallback. |
| Estimate/object/project media binding | `BLOCKED` | `PARTIAL` | Integrate exact binding/media chain (#444/#455, floor binding #380/#441, chat media #456) on one main lineage. |
| Calendar/stage child-resource scope | `BLOCKED` | `PARTIAL` | Integrate/requalify #424 and #452; then qualify #461 atomic import. |
| Project purge/retention/storage graph | `BLOCKED` | `BLOCKED` | Close #319 on physical PostgreSQL + storage cleanup/retention outcomes. |
| Native authenticated file delivery | `BLOCKED` | `BLOCKED` | Close #320 on native save/share + session/ACL/cancellation tests. |
| Golden Path executable suites | `BLOCKED` | `BLOCKED` | #337 + D1 #357: GP1–GP8 API and mobile-web green on one exact integrated SHA. |
| Simulated payment provider lifecycle | `BLOCKED` | `BLOCKED` | A3/A4: create→pending→success/cancel/refund through same webhook/domain path. |
| Simulated fiscal/NPD provider slice | `PARTIAL` | `CANDIDATE PROVEN` | Rebase/requalify #426; still not a GP5/GP6 completion claim. |
| Real staging/artifact promotion | `FUTURE EXTERNAL` | `FUTURE EXTERNAL` | #233 after internal PRODUCT COMPLETE; exact external environment evidence. |
| Production backup/restore/PITR | `FUTURE EXTERNAL` | `FUTURE EXTERNAL` | #234 after managed infrastructure exists. |
| External observability/alert delivery | `FUTURE EXTERNAL` | `FUTURE EXTERNAL` | #235; external ingestion + alert delivery + ACK evidence. |
| Real YooKassa/FNS/Kontur/Goskey/retail/bank activation | `FUTURE EXTERNAL` | `FUTURE EXTERNAL` | Separate provider qualification; never required to fake simulated PRODUCT COMPLETE. |

## 6. Candidate evidence ledger

Only candidates whose PR body records bounded exact-head evidence are allowed to promote a cell to `CANDIDATE PROVEN`. They still require refresh/rebase and full requalification after prerequisites land.

### Strong bounded candidates already carrying exact-head evidence

- #425 — required CI/bootstrap.
- #389 — PCRE2 backend image remediation on #425 lineage.
- #372 — bounded npm lock remediation on #425 lineage.
- #437 — required-context scheduling on #425 lineage.
- #424 — calendar stage-date project binding.
- #452 — stage reaction project/stage/comment binding on temporary #425 lineage.
- #381 — explicit material actual zero truth.
- #382 — budget period conservation + unavailable portfolio fact.
- #322 — chat invoice/task atomicity + replay.
- #385 — chat reaction replay on #322 lineage.
- #387 — intent-aware offline queue dedupe on #322 lineage.
- #448 — Change Order decision/replay/conflict lifecycle.
- #455 — project-media ACL.
- #456 — chat-media ACL on #455 lineage.
- #457 — draft estimate-line remove/restore lifecycle.
- #460 — material-needs response-loss safety on #322 lineage.

### Existing candidates that remain `PARTIAL`/`BLOCKED` until exact required evidence is complete

- #450 — registry retry exact qualification incomplete at the recorded cut.
- #461 — iCalendar exact-head evidence pending.
- #458 — connected GP1 explicitly `Chain verified: Pending`; no GP1 promotion.
- #434/#440/#438 — useful project/room lifecycle slices, but no final integrated GP1 proof.
- #383 — direct WorkOrder candidate body still records qualification pending.
- #392 — chat-thread replay candidate pending.
- #404 — stage-comment replay candidate pending.
- #412 — estimate-line create response-loss candidate pending.
- #414 — design-package create response-loss candidate pending.
- #416 — selection create response-loss candidate pending.
- #418/#459 — issue-create recovery qualification still pending/integration-only.
- #429 — participant API client only; no screen/scope adoption.
- #428 — server logout revoke only; #315 session generation remains.
- #367 — review/demo entry correctness; not product-completion proof.
- #366/#432 — governance/source inventory; documentation and source classification never promote runtime E2E cells by themselves.

## 7. Final integration DAG — no scope expansion

This sequence is derived mechanically from the `BLOCKED` cells above. Every step reuses an existing issue/PR or the already-governed mandate; it introduces no new product capability.

### Wave 0 — make exact integration evidence trustworthy

1. **#425** owner review/merge: restore protected-main CI bootstrap and canonical runtime source.
2. Refresh onto resulting `main`, exact requalify, then owner review: **#389** (backend image) and **#372** (npm lock).
3. Refresh/requalify **#437** required-context scheduling.
4. Finish/qualify **#450** bounded registry retry; integrate only if exact candidate is green.
5. Apply and verify live branch/ruleset settings under **#247**. Repository settings are not replaced by green source CI.

**Promotion:** removes CI/source ambiguity so later `CANDIDATE PROVEN` can be trusted on one mainline.

### Wave 1 — security and data truth before wider lifecycle replay

6. Refresh/requalify project/object binding chain: **#444** estimate-line path binding; **#380/#441** floor references; **#424** calendar stage write scope; **#452** stage-reaction child scope.
7. Refresh/requalify file authority chain: **#455** project media, then **#456** chat attachments.
8. Refresh/requalify financial truth: **#381** explicit zero actual, then **#382** conserved period plan/unavailable fact.

**Promotion:** F03/F04/F05/F17/F21 security/linked-fact cells can advance; GP1/GP3/GP5/GP6 remain blocked until integration/recovery.

### Wave 2 — replay/atomicity foundation

9. Refresh/requalify and owner review **#322** first; it is the prerequisite for the stacked recovery tree.
10. Rebase every #322 child on the resulting `main`; integrate only exact-qualified bounded deltas. Cross-cutting early order: **#387** intent-aware queue dedupe, then **#385** chat reaction replay.
11. Qualify and integrate remaining known create/command identities without widening scope: **#383** WorkOrder, **#392** chat thread, **#404** stage comment, **#412** estimate line, **#414** design package, **#416** selection, **#418/#459** issue create, **#460** material needs.
12. After calendar security #424 and recovery base are integrated, finish exact qualification of **#461** iCalendar atomic import.
13. Re-run the complete #316 mutation inventory. No row may remain an unsafe queued create/toggle or split transaction before #316 closes.

**Promotion:** M11 remains blocked until the inventory is complete, but individual F04/F06/F07/F09/F11/F20/F21/F24 retry cells advance from BLOCKED to PROVEN only after main integration.

### Wave 3 — session/offline global correctness

14. Close **#315** session generation/account/project/cache/queue/file fencing, including delayed A→B→A tests.
15. Close **#317** central transport classification and cache provenance only after replay-sensitive mutations are safe.
16. Re-run account-switch + offline/restart suites across all queued families.

**Promotion:** M11 and M12 can advance; no stale A response, cached fact, file or queue job may publish under B/A2.

### Wave 4 — close GP1 as the first connected lifecycle

17. Refresh/requalify **#434** reversible project lifecycle.
18. Refresh/requalify **#438/#440** room create/request/lifecycle and consume server room authority in UI.
19. Integrate **#457** estimate-line reversal and **#448** Change Order lifecycle on the current main.
20. Rebuild **#458** on that integrated line and include the now-qualified estimate-line create response-loss path (#412). Add the required connected `e2e/golden/gp1...` + mobile-web path.
21. GP1 can change from `BLOCKED` only when the same exact SHA proves project→room→estimate→budget→reversal/retry with authoritative linked facts.

### Wave 5 — independent participants before GP2/GP3 promotion

22. Finish **#300/#344** ProjectParticipant scope adoption across stages, schedule, work orders, chat, notifications, documents, materials, expenses/payee visibility.
23. Finish **#345/#429** participant UX/client wiring and direct/marketplace transitions.
24. Run the mandatory two/three-independent-contractor sibling negatives and customer aggregate reads.
25. Only then connect GP2 and GP3 API + mobile-web suites.

**Promotion:** M03 and M06 cannot leave `BLOCKED` earlier.

### Wave 6 — lifecycle closure edges

26. Close **#319** governed permanent purge/retention/storage cleanup.
27. Close **#320** canonical authenticated native file save/share; depend on #315 session fence.
28. Complete M07 supervisor, M08 viewer/revoke, M09 portal token and M10 warranty/history paths through existing services; no new hubs.
29. Finish simulated provider tasks already in the mandate (A3/A4 and remaining simulated adapters) without real-provider activation.
30. Build/reconcile C1 controlled realistic data only after participant/provider truth is integrated.

### Wave 7 — one integrated PRODUCT COMPLETE candidate

31. Implement/finish A1/#337 executable GP files where still absent; do not mark tests allowed-green by documentation.
32. Run **GP1–GP8 API + mobile-web** on one exact integrated SHA, canonical PostgreSQL/Redis/MinIO/API/Worker, simulated providers.
33. Run M01–M12 dispositions, including M11 response-loss and M12 A→B→A.
34. Run role/ACL negative paths, reversal/recovery, native/file paths and derived-finance reconciliation.
35. D1/#357 and D2/#358 may close only from those results; E3/#362 publishes the same truth, not a separate readiness opinion.

## 8. PRODUCT COMPLETE exit gate

A PRODUCT COMPLETE claim is permitted only when all conditions below hold simultaneously on one exact integrated SHA:

1. Every applicable critical Board cell is `PROVEN`; no critical cell remains `PARTIAL` or `BLOCKED`.
2. GP1–GP8 are green in API and mobile-web form on canonical PostgreSQL + Redis + MinIO + API + Worker with simulated providers.
3. M01–M12 have explicit tested disposition; M03, M11 and M12 are not waived.
4. Every replay-sensitive mutation uses stable identity/version fencing before first retry; same intent converges, changed payload conflicts, deliberate duplicate intent survives.
5. Customer/contractor/admin/portal authority is checked on the authoritative object before mutation and after relevant lock waits.
6. Every committed business mutation reconciles linked calculations/read models and second-side visibility without treating refresh failure as rollback.
7. Business reversal and restore/reconcile preserve audit/history; archive, trash and purge remain distinct.
8. Session/account switch prevents stale network/cache/storage/queue/file publication across generations.
9. Multi-contractor sibling isolation and customer aggregate views are proven.
10. Financial plan/revised/committed/actual/payment/receipt/refund states do not substitute for one another; unknown remains unknown.
11. Project/chat/document media bytes share the same current authority boundary as their owning business object.
12. Candidate evidence has been rerun after every prerequisite integration; no stale old-base PR result is counted as integrated truth.
13. Production-only external items may remain `FUTURE EXTERNAL`, but they must not be represented as already operational.

At that point the remaining work is deployment/provider qualification rather than completion of the internal RENOVA product graph.
