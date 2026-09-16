# RENOVA — Product Completion Board

**Status:** P0 governance / execution board  
**Tracking:** #463  
**Evidence cut:** canonical `main` = `e5c6ee44c0f684b14037e77948dbcb630fd41896` (2026-09-08)  
**Purpose:** convert the existing RENOVA capability graph into closed end-to-end lifecycles and a deterministic final integration order. This document adds no product feature, provider, route, state machine or user hub.

## 0. Completion invariant

RENOVA is PRODUCT COMPLETE only when every applicable product path closes this lifecycle without a truth break:

`create → authoritative read → update/transition → second-side visibility → linked calculation/read-model reconciliation → cancel/business reversal → restore/reconcile → offline/response-loss safe retry → account/session isolation → closeout → historical evidence/warranty`.

A rendered screen, reachable route, source inventory, isolated unit test or isolated PR does not by itself close that lifecycle.

### Status vocabulary — the only five readiness states

| Status | Meaning |
|---|---|
| `PROVEN` | Required behavior is present on canonical `main` and exact-main evidence proves the requested cell on the required runtime/layer. |
| `CANDIDATE PROVEN` | Exact-head candidate evidence proves that bounded cell, but the candidate is not integrated into canonical `main`. |
| `PARTIAL` | Capability exists or a subset is covered, but the requested cell/lifecycle is not fully proven. |
| `BLOCKED` | A source-confirmed defect or prerequisite prevents a safe completion claim. |
| `FUTURE EXTERNAL` | Intentionally outside simulated-provider PRODUCT COMPLETE and requires later real provider/infrastructure/native-distribution evidence. |

Open-PR evidence can never be `PROVEN`. Two independently green PRs on different bases do not compose into one green product SHA.

## 1. Board model

The conceptual board is:

`M01–M12 × GP1–GP8 × 26 mutation surfaces × role × layer × outcome × main/candidate`.

A literal Cartesian dump would contain thousands of meaningless combinations. The canonical board is normalized into joined tables:

1. **Mode Board** — M01–M12.
2. **Golden Path Board** — GP1–GP8.
3. **Mutation Board** — the exact 26 mutating mobile API surfaces discovered by #431 / PR #432.
4. **Layer Integrity Board** — UI/API/PostgreSQL/Redis/MinIO/Worker cross-cutting proof.
5. **Candidate Evidence Ledger** — what can legitimately be called `CANDIDATE PROVEN`.
6. **Final Integration DAG** — the bounded merge/requalification order.

The Mutation Board carries Mode/GP/role/layer applicability. Joining those keys with the first two tables yields every applicable product cell without inventing a sixth `N/A` readiness state.

Roles: `C` = customer; `K` = contractor/principal/team actor as authorized; `A` = admin/operator; `V` = viewer/portal actor.  
Layers: `UI`, `API`, `PG` = PostgreSQL, `Redis`, `MinIO`, `Worker`.

Outcome columns are distinct:
- **Normal** — authorized mutation + authoritative read-after-write.
- **Error** — wrong role/object/version/payload/provider state fails closed with typed behavior and no partial write.
- **Offline** — no-network/timeout path retains the exact intended mutation or fails explicitly; stale cached truth is not relabeled as fresh.
- **Retry** — response-loss/restart/repeated intent converges idempotently; changed payload conflicts where required.
- **Reverse** — cancel/delete/reject/rework/archive/restore/reconcile lifecycle where the domain supports it.
- **Linked** — second side, derived calculations/read models, audit/outbox/worker and related facts converge to the committed business truth.

## 2. Mode Board — M01–M12

The mode vocabulary follows the governed scenario model introduced by #365/#366. Because #366 is still an open documentation candidate at this evidence cut, this Board adopts the vocabulary but does not import any runtime readiness claim from that PR.

| Mode | Required closed chain | Main | Best candidate | Completion state | Dominant gap |
|---|---|---|---|---|---|
| M01 Self-managed | object → estimate → self-plan/work → materials → expenses/docs → closeout | `PARTIAL` | `PARTIAL` | `PARTIAL` | No one-SHA API + mobile-web proof through recovery and closeout. |
| M02 One contractor | invite/lead → participant → work → acceptance → money/docs → warranty | `PARTIAL` | `PARTIAL` | `PARTIAL` | Bounded slices exist, but the whole one-contractor lifecycle is not connected. |
| M03 Multi-contractor | independent principals → scoped work/finance/docs/chat → customer aggregate truth | `BLOCKED` | `BLOCKED` | `BLOCKED` | #300, #344, #345. |
| M04 Contractor with team | principal commercial authority → subordinate execution → no payee/contract leakage | `PARTIAL` | `PARTIAL` | `PARTIAL` | Team behavior exists, but commercial-vs-execution authority is not closed across all domains. |
| M05 Direct invite | invite → identity/accept → participant/scope → ordinary project lifecycle | `PARTIAL` | `PARTIAL` | `PARTIAL` | Invite failure/recovery/role lifecycle is not qualified end-to-end. |
| M06 Marketplace conversion | lead → quotes → choose → atomic participant conversion → project lifecycle | `BLOCKED` | `BLOCKED` | `BLOCKED` | #300/#344/#345 prevent final scoped participant truth. |
| M07 Technical supervision | assign supervisor → inspect/evidence → issue/remediation → customer decision | `PARTIAL` | `PARTIAL` | `PARTIAL` | No complete role-rights E2E proof. |
| M08 Viewer/guest | bounded share/read → revoke → stale-link denial | `PARTIAL` | `PARTIAL` | `PARTIAL` | Revocation/file/session lifecycle is not closed. |
| M09 Portal-token | bounded token → canonical action → replay/revoke/expiry | `PARTIAL` | `PARTIAL` | `PARTIAL` | Portal slices exist; no complete token lifecycle. |
| M10 Closed/warranty | complete → archive/export → warranty → historical responsibility → claim closure | `BLOCKED` | `BLOCKED` | `BLOCKED` | #319 plus disconnected closeout/warranty history. |
| M11 Unstable network | offline/cache → exact intent → response-loss replay → reconcile | `BLOCKED` | `BLOCKED` | `BLOCKED` | #316 and #317 remain open despite bounded recovery candidates. |
| M12 Account switch | A request/queue/cache → logout/B → no A publication/execution → A2 isolation | `BLOCKED` | `BLOCKED` | `BLOCKED` | #315; #428 proves only a bounded server logout-revoke slice. |

**Mode result:** no M01–M12 mode is `PROVEN` under the strict full-lifecycle contract on the current canonical `main`.

## 3. Golden Path Board — GP1–GP8

`GOLDEN-PATHS.md` requires every GP in both API and mobile-web form on canonical PostgreSQL + Redis + MinIO + API + Worker with simulated providers. At this evidence cut the canonical `main` does not carry the required connected GP1–GP8 completion suites; A1/#337 and D1/#357 remain the governing delivery gates. An isolated lifecycle PR therefore cannot promote a Golden Path to `PROVEN`.

| GP | Roles | Layers | Normal | Error | Offline | Retry | Reverse | Linked | Integrated candidate | Final gate | Dominant evidence/gap |
|---|---|---|---|---|---|---|---|---|---|---|---|
| GP1 Object → Rooms → Estimate → Budget | C, K | UI, API, PG, Redis | `PARTIAL` | `PARTIAL` | `BLOCKED` | `BLOCKED` | `PARTIAL` | `PARTIAL` | `BLOCKED` | `BLOCKED` | #458 says chain verification pending; #457 and #448 are bounded candidates; #412 still pending. |
| GP2 Marketplace → Quotes → Selection → Executor | C, K1, K2 | UI, API, PG, Redis, Worker | `BLOCKED` | `BLOCKED` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `BLOCKED` | `BLOCKED` | `BLOCKED` | #300/#344/#345; #429 is client foundation, not full participant adoption. |
| GP3 Stages + Calendar → WorkOrder → Evidence → Progress | C, K1, K2 | UI, API, PG, Redis, MinIO, Worker | `BLOCKED` | `BLOCKED` | `BLOCKED` | `BLOCKED` | `PARTIAL` | `PARTIAL` | `BLOCKED` | `BLOCKED` | #344, #421/#424, #451/#452, #316, #375. |
| GP4 Acceptance → Rework → Portal Acceptance → Warranty | C, K, V | UI, API, PG, Redis, MinIO, Worker | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `BLOCKED` | Acceptance pieces exist; portal/rework/warranty/closeout are not one connected proof. |
| GP5 Invoice → Payment → Receipt → Expense → Dispute/Refund | C, K, A | UI, API, PG, Redis, Worker | `BLOCKED` | `BLOCKED` | `BLOCKED` | `BLOCKED` | `BLOCKED` | `BLOCKED` | `BLOCKED` | `BLOCKED` | A3/A4, #318, #316/#317. #322 proves only bounded chat command atomicity/replay. |
| GP6 Material → Approval → Purchase → Delivery → Receipt | C, K | UI, API, PG, Redis, Worker | `PARTIAL` | `PARTIAL` | `BLOCKED` | `BLOCKED` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `BLOCKED` | #460 is a bounded material-needs candidate; broader purchase/supply/reversal remains. |
| GP7 Documents → Versions → E-sign → Archive/Export | C, K | UI, API, PG, MinIO, Worker | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `BLOCKED` | #320 native authenticated delivery; no complete version/sign/export mobile-web chain. |
| GP8 Chat → Inbox/Push → Read Truth → Reminder | C, K | UI, API, PG, Redis, MinIO, Worker | `PARTIAL` | `PARTIAL` | `BLOCKED` | `BLOCKED` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `BLOCKED` | #315/#316/#317; #322/#385/#387 bounded; #392 thread creation still pending. |

**Golden Path result:** no GP can be promoted until one exact integrated SHA contains its prerequisites and both its API and mobile-web suites are green.

## 4. Mutation Board — exact 26 mutating surfaces

The executable inventory in #431 / PR #432 discovers **26** mutating mobile API modules. It classifies **25 business-domain modules** and separately permits one transport mutation in `client.ts`: `/api/v1/auth/refresh`. The Board mirrors that inventory one-for-one; it does not invent a 26th business object.

| ID | Surface | Roles | Modes / GPs | Layers | Main Normal | Cand Normal | Main Error | Cand Error | Main Offline | Cand Offline | Main Retry | Cand Retry | Main Reverse | Cand Reverse | Main Linked | Cand Linked | Evidence boundary |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| F01 | `admin.ts` — team/invite/subscription/operator-admin mutations | K, A | M02–M07 / cross-GP | UI, API, PG, Redis, Worker | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | Existing admin/team/subscription flows are not one role/lifecycle proof; operator-only surfaces must remain operator-only. |
| F02 | `auth.ts` — OTP/session/login/logout identity mutations | C, K, A | M01–M12 / all GP entry | UI, API, PG, Redis | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `BLOCKED` | `BLOCKED` | `BLOCKED` | `BLOCKED` | `PARTIAL` | `CANDIDATE PROVEN` | `BLOCKED` | `BLOCKED` | #428 proves bounded server logout revocation only; #315 still blocks generation/account-switch isolation. |
| F03 | `calendar.ts` — calendar/stage dates/iCalendar | C, K | M01–M07 / GP3 | UI, API, PG, Redis, Worker | `BLOCKED` | `PARTIAL` | `BLOCKED` | `CANDIDATE PROVEN` | `BLOCKED` | `BLOCKED` | `BLOCKED` | `BLOCKED` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | #421 is fixed by bounded #424 candidate; #422/#461 atomic iCalendar replay remains pending exact qualification. |
| F04 | `chats.ts` — threads/messages/reactions/tasks/invoices | C, K | M02–M12 / GP5, GP8 | UI, API, PG, Redis, MinIO, Worker | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `BLOCKED` | `PARTIAL` | `BLOCKED` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | #322/#385/#387 prove bounded replay slices; #392 and #317 prevent family-wide closure. |
| F05 | `design.ts` — design packages/submit/decision/version | C, K | M01–M05 / GP1, GP7 | UI, API, PG, MinIO, Worker | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `BLOCKED` | `BLOCKED` | `BLOCKED` | `BLOCKED` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | #413/#414 response-loss candidate remains pending; #315/#320 affect native/file boundaries. |
| F06 | `documents.ts` — documents/e-sign/version/export | C, K | M01–M10 / GP4, GP7 | UI, API, PG, MinIO, Worker | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | No one-SHA create→version→sign→export→revoke/native lifecycle; #320 is a confirmed delivery gap. |
| F07 | `estimate.ts` — estimate lines/decisions/Change Orders/budget linkage | C, K | M01–M06 / GP1, GP5, GP6 | UI, API, PG, Worker | `BLOCKED` | `PARTIAL` | `BLOCKED` | `PARTIAL` | `BLOCKED` | `BLOCKED` | `BLOCKED` | `BLOCKED` | `PARTIAL` | `CANDIDATE PROVEN` | `PARTIAL` | `CANDIDATE PROVEN` | #457 proves bounded draft-line remove/restore + budget restoration; #448 proves bounded Change Order conflict/decision; #412 and #375/#444 remain. |
| F08 | `floor.ts` — floor plans/pins/furniture | C, K | M01–M03 / GP1 | UI, API, PG, MinIO | `BLOCKED` | `PARTIAL` | `BLOCKED` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | Cross-project binding #377; #380/#441 are bounded binding candidates, not full lifecycle proof. |
| F09 | `issues.ts` — punch/quality issue lifecycle | C, K, A as authorized | M02–M10 / GP3, GP4 | UI, API, PG, MinIO, Worker | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `BLOCKED` | `BLOCKED` | `BLOCKED` | `BLOCKED` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | #417/#418/#459 recovery qualification is not yet final on integrated main. |
| F10 | `market.ts` — leads/quotes/selection/conversion | C, K | M02–M06 / GP2 | UI, API, PG, Redis, Worker | `PARTIAL` | `PARTIAL` | `BLOCKED` | `BLOCKED` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `BLOCKED` | `BLOCKED` | Final conversion must create scoped participant truth; #300/#344/#345 remain open. |
| F11 | `materials.ts` — needs/picks/purchases/supply/prices | C, K | M01–M07 / GP6 | UI, API, PG, Redis, Worker | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `BLOCKED` | `PARTIAL` | `BLOCKED` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | #460 proves bounded material-needs response-loss on stacked lineage; broader family plus #317 remain. |
| F12 | `misc.ts` — viewers/portal/approvals/general mutations | C, K, V | M02–M10 / GP4, GP7 | UI, API, PG, Redis, Worker | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | Portal/viewer bounded slices do not close revoke/expiry/session/native lifecycle. |
| F13 | `notifications.ts` — notification read/action/dismiss | C, K, A | M02–M12 / GP2–GP8 | UI, API, PG, Redis, Worker | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | Canonical source entity and session generation must remain authoritative; #315 affects cross-account publication. |
| F14 | `os.ts` — workspace/profile/dashboard OS mutations | C, K | M01–M12 / cross-GP | UI, API, PG, Redis | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | Analytics/read models remain subject to participant, finance and session truth; #431 marks some latent analytics EXPOSE_AFTER_FIX. |
| F15 | `payments.ts` — payment/evidence/dispute/refund | C, K, A | M02–M12 / GP5 | UI, API, PG, Redis, Worker | `BLOCKED` | `PARTIAL` | `BLOCKED` | `PARTIAL` | `BLOCKED` | `BLOCKED` | `BLOCKED` | `PARTIAL` | `BLOCKED` | `PARTIAL` | `BLOCKED` | `PARTIAL` | A3/A4 simulated payment lifecycle and #318 finance truth remain; #322 invoice command explicitly does not create provider/Expense truth. |
| F16 | `projects.ts` — create/edit/participant/assignment/archive/trash/restore/purge | C, K, A | M01–M12 / GP1–GP8 | UI, API, PG, Worker | `PARTIAL` | `PARTIAL` | `BLOCKED` | `PARTIAL` | `BLOCKED` | `PARTIAL` | `BLOCKED` | `PARTIAL` | `BLOCKED` | `PARTIAL` | `BLOCKED` | `BLOCKED` | #434 is bounded reversible lifecycle evidence; #319 blocks purge; #300/#344/#345 block participant/sibling truth. |
| F17 | `receipts.ts` — receipt/expense/reverify/delete | C, K, A | M01–M12 / GP5, GP6 | UI, API, PG, Redis, Worker | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `BLOCKED` | `BLOCKED` | `BLOCKED` | `BLOCKED` | `PARTIAL` | `PARTIAL` | `BLOCKED` | `PARTIAL` | #317 transport/cache truth and #318/#379 financial fact truth; #381/#382 are bounded candidates. |
| F18 | `rooms.ts` — room create/edit/change request/archive/restore | C, K | M01–M06 / GP1, GP6 | UI, API, PG, Worker | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `BLOCKED` | `PARTIAL` | `BLOCKED` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | #438/#440 provide bounded room candidates; connected room authority + derived facts remain #458 pending. |
| F19 | `scratchpad.ts` — create/edit/delete/promote | C, K | M01–M08 / secondary | UI, API, PG | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | Contextual capability exists; no connected lifecycle proof is recorded at this cut. |
| F20 | `selections.ts` — finish/material selections and decisions | C, K | M01–M07 / GP6 | UI, API, PG, Worker | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `BLOCKED` | `BLOCKED` | `BLOCKED` | `BLOCKED` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | #415/#416 response-loss candidate remains pending qualification. |
| F21 | `stages.ts` — stages/status/comments/reactions/progress | C, K | M01–M10 / GP3, GP4 | UI, API, PG, Redis, MinIO, Worker | `BLOCKED` | `PARTIAL` | `BLOCKED` | `CANDIDATE PROVEN` | `BLOCKED` | `BLOCKED` | `BLOCKED` | `BLOCKED` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | #424/#452 prove bounded child-resource ACL; #404 stage-comment replay remains pending. |
| F22 | `technicalSupervision.ts` — supervisor assignment/inspection/quality | C, K, A/supervisor | M07 / GP4 | UI, API, PG, MinIO, Worker | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | No full assignment→finding→remediation→customer-decision proof. |
| F23 | `workAcceptances.ts` — submit/accept/return/rework | C, K, V | M02–M10 / GP4 | UI, API, PG, Worker | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | Acceptance contracts are prerequisites, but warranty/portal/retry/full GP4 are not one-SHA proven. |
| F24 | `workOrders.ts` — create/edit/transition | C, K | M01–M07 / GP3 | UI, API, PG, Redis, Worker | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `BLOCKED` | `BLOCKED` | `BLOCKED` | `BLOCKED` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | Direct-create response-loss remains #316/#383; #383 qualification is pending. |
| F25 | `workSchedule.ts` — schedule/items/submit/decision | C, K | M01–M07 / GP3 | UI, API, PG, Redis, Worker | `BLOCKED` | `BLOCKED` | `BLOCKED` | `BLOCKED` | `BLOCKED` | `BLOCKED` | `BLOCKED` | `BLOCKED` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | #420 plus #316 replay policy; no bounded qualified candidate at this cut. |
| F26 | `client.ts` — transport/session refresh mutation owner | C, K, A | M01–M12 / all GPs | UI, API, Redis | `BLOCKED` | `PARTIAL` | `BLOCKED` | `PARTIAL` | `BLOCKED` | `BLOCKED` | `BLOCKED` | `BLOCKED` | `PARTIAL` | `CANDIDATE PROVEN` | `BLOCKED` | `BLOCKED` | This is infrastructure, not a business family. #315 blocks generation/A→B→A isolation; #317 blocks transport/cache truth; #428 proves only server logout revocation. |

### 4.1 Count invariant

The business modules are exactly:

`admin, auth, calendar, chats, design, documents, estimate, floor, issues, market, materials, misc, notifications, os, payments, projects, receipts, rooms, scratchpad, selections, stages, technicalSupervision, workAcceptances, workOrders, workSchedule`.

That is **25 business modules**. Adding `client.ts` produces the executable scanner total of **26 mutating modules**. Participant scope is part of `projects.ts`; room-derived calculation is part of `rooms.ts`; neither is double-counted as a new mutation family.

## 5. Layer Integrity Board

This table prevents a UI-green path from masking a backend/storage/worker truth break. It is cross-cutting; family-specific applicability remains in section 4.

| Layer | Main Normal | Main Error | Main Offline | Main Retry | Main Reverse | Candidate best state | Dominant gate |
|---|---|---|---|---|---|---|---|
| UI | `PARTIAL` | `PARTIAL` | `BLOCKED` | `BLOCKED` | `PARTIAL` | `PARTIAL` | #315/#317 plus missing connected mobile-web GP suites. |
| API | `PARTIAL` | `BLOCKED` | `BLOCKED` | `BLOCKED` | `PARTIAL` | `PARTIAL` | Object binding, participant scope, idempotency inventory. |
| PG | `PARTIAL` | `PARTIAL` | `PARTIAL` | `BLOCKED` | `PARTIAL` | `PARTIAL` | Transaction/ledger races, purge graph, finance facts, multi-contractor scope. |
| Redis | `PARTIAL` | `PARTIAL` | `BLOCKED` | `BLOCKED` | `PARTIAL` | `PARTIAL` | Queue/cache/session provenance and account generation. |
| MinIO | `BLOCKED` | `BLOCKED` | `PARTIAL` | `PARTIAL` | `BLOCKED` | `PARTIAL` | #455/#456 candidates, #320 native delivery, #319 purge/storage cleanup. |
| Worker | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | `PARTIAL` | Outbox/provider/reconciliation must be proven inside connected GPs, not only by source presence. |

No layer is currently globally `PROVEN`; a layer may still contain individually proven lower-level tests, but the Board deliberately measures complete product behavior.

## 6. Cross-cutting integrity gates

| Gate | Main | Candidate | Promotion condition |
|---|---|---|---|
| Protected-main / required-check bootstrap | `BLOCKED` | `CANDIDATE PROVEN` | Owner integrate/requalify #425; separately verify live ruleset #247. |
| Backend image fixed HIGHs | `BLOCKED` | `CANDIDATE PROVEN` | Refresh/requalify #389 on resulting main. |
| JS dependency fixed advisories | `BLOCKED` | `CANDIDATE PROVEN` | Refresh/requalify #372 on resulting main. |
| Required PR-context scheduling | `BLOCKED` | `CANDIDATE PROVEN` | Refresh/requalify #437 after #425. |
| Registry pull reliability | `PARTIAL` | `PARTIAL` | Finish exact #450 qualification, then refresh onto main. |
| Session/account generation fence | `BLOCKED` | `BLOCKED` | Close #315 with delayed A→B→A, storage, navigation, cache and queue tests. |
| Offline mutation identity/atomicity | `BLOCKED` | `PARTIAL` | Finish #316 inventory; no unsafe queued create/toggle remains. |
| Transport enqueue + cache provenance | `BLOCKED` | `BLOCKED` | Close #317 after replay-sensitive mutations are safe. |
| Participant/sibling scope isolation | `BLOCKED` | `BLOCKED` | #300 + #344 + #345, including customer aggregate and sibling negatives. |
| Finance/budget/material fact truth | `BLOCKED` | `PARTIAL` | Integrate/requalify #381/#382 with affected producers; no plan→fact fallback. |
| Object/project/media binding | `BLOCKED` | `PARTIAL` | Integrate binding/media chain (#444, #380/#441, #455/#456) on one main lineage. |
| Calendar/stage child scope | `BLOCKED` | `PARTIAL` | Integrate/requalify #424/#452, then qualify #461. |
| Project purge/retention/storage graph | `BLOCKED` | `BLOCKED` | Close #319 on physical PostgreSQL plus storage retention/cleanup outcomes. |
| Native authenticated file delivery | `BLOCKED` | `BLOCKED` | Close #320 with session fence, save/share, cancellation and ACL tests. |
| Golden Path executable suites | `BLOCKED` | `BLOCKED` | #337 + D1/#357: GP1–GP8 API and mobile-web green on one exact SHA. |
| Simulated payment-provider lifecycle | `BLOCKED` | `BLOCKED` | A3/A4 through the same webhook/domain path used by the product. |
| Simulated fiscal/NPD slice | `PARTIAL` | `CANDIDATE PROVEN` | Refresh/requalify #426; this alone is not a GP5/GP6 completion claim. |
| Real staging/artifact promotion | `FUTURE EXTERNAL` | `FUTURE EXTERNAL` | #233 after internal PRODUCT COMPLETE. |
| Production backup/restore/PITR | `FUTURE EXTERNAL` | `FUTURE EXTERNAL` | #234 after managed infrastructure exists. |
| External observability/alert delivery | `FUTURE EXTERNAL` | `FUTURE EXTERNAL` | #235 with ingestion + alert delivery + ACK evidence. |
| Real YooKassa/FNS/Kontur/Goskey/retail/bank activation | `FUTURE EXTERNAL` | `FUTURE EXTERNAL` | Separate provider qualification; never faked inside simulated PRODUCT COMPLETE. |

## 7. Candidate Evidence Ledger

A candidate can promote only the bounded cells its exact-head evidence actually proves. It must be refreshed and rerun after prerequisites land.

### Exact bounded candidates already carrying strong evidence

- #425 — CI/governance bootstrap.
- #389 — backend image PCRE2 remediation on #425 lineage.
- #372 — bounded npm lock remediation on #425 lineage.
- #437 — required-context scheduling on #425 lineage.
- #424 — calendar/stage-date project binding.
- #452 — stage-reaction project/stage/comment binding.
- #381 — explicit material actual zero truth.
- #382 — budget-period conservation + unavailable portfolio fact.
- #322 — chat invoice/task atomicity + replay.
- #385 — chat reaction replay on #322 lineage.
- #387 — intent-aware offline queue dedupe on #322 lineage.
- #448 — Change Order decision/replay/terminal-conflict lifecycle.
- #455 — project-media ACL.
- #456 — chat-media ACL on #455 lineage.
- #457 — draft estimate-line remove/restore lifecycle.
- #460 — material-needs response-loss safety on #322 lineage.

### Useful candidates that remain `PARTIAL`/`BLOCKED` at this cut

- #450 — registry retry exact qualification incomplete.
- #461 — iCalendar exact-head evidence pending.
- #458 — connected GP1 explicitly reports `Chain verified: Pending`; no GP1 promotion.
- #434/#438/#440 — project/room lifecycle slices, not final GP1 proof.
- #383 — direct WorkOrder recovery qualification pending.
- #392 — chat-thread replay qualification pending.
- #404 — stage-comment replay qualification pending.
- #412 — estimate-line create response-loss qualification pending.
- #414 — design-package create response-loss qualification pending.
- #416 — selection create response-loss qualification pending.
- #418/#459 — issue-create recovery qualification pending/integration-only.
- #429 — participant API client foundation only; no screen/scope adoption.
- #428 — server logout revoke only; #315 still blocks session generation.
- #367 — review/demo entry correctness, not product-completion proof.
- #366/#432 — governance/source inventory; documentation/source classification cannot promote runtime E2E cells.

## 8. Final Integration DAG — no scope expansion

Every step below retires existing `BLOCKED`/`PARTIAL` cells. It introduces no new product domain or user hub.

### Wave 0 — make integration evidence trustworthy

1. Owner review/integrate **#425**: protected-main CI bootstrap and canonical runtime source.
2. Refresh onto the resulting `main`, exact requalify, then owner review **#389** and **#372**.
3. Refresh/requalify **#437** required-context scheduling.
4. Finish exact qualification of **#450** registry retry; integrate only if the refreshed candidate is green.
5. Apply and verify live branch/ruleset settings under **#247**; repository settings are not replaced by green source CI.

### Wave 1 — security and data truth before wider replay

6. Refresh/requalify object-binding chain: **#444**, **#380/#441**, **#424**, **#452**.
7. Refresh/requalify file authority chain: **#455** then **#456**.
8. Refresh/requalify finance truth: **#381** then **#382**, including affected producers/read models.

### Wave 2 — replay and atomicity foundation

9. Refresh/requalify **#322** first; it is the prerequisite for its stacked recovery tree.
10. Rebase each #322 child onto resulting `main`; integrate only exact-qualified bounded deltas. Cross-cutting early order: **#387** then **#385**.
11. Finish/qualify known response-loss identities without widening scope: **#383, #392, #404, #412, #414, #416, #418/#459, #460**.
12. After #424 and the recovery base are integrated, finish exact qualification of **#461** iCalendar atomic import.
13. Re-run the complete **#316** mutation inventory. No reachable offline create/toggle/split transaction may remain unsafe.

### Wave 3 — global session/offline correctness

14. Close **#315** session-generation/account/project/cache/queue/file fencing, including delayed A→B→A.
15. Close **#317** central transport classification and cache provenance after replay-sensitive mutations are safe.
16. Re-run account-switch + offline/restart suites across every queued family.

### Wave 4 — close GP1 as the first connected lifecycle

17. Refresh/requalify **#434** reversible project lifecycle.
18. Refresh/requalify **#438/#440** room create/request/lifecycle and consume server room authority in UI.
19. Integrate **#457** estimate-line reversal and **#448** Change Order lifecycle on current main.
20. Rebuild **#458** on that integrated line, include qualified estimate-line create recovery (#412), and add the connected API + mobile-web GP1 suite.
21. GP1 changes state only when the same exact SHA proves project→room→estimate→budget→second-side/derived truth→reversal→retry.

### Wave 5 — independent participants before GP2/GP3

22. Finish **#300/#344** ProjectParticipant scope adoption across stages, schedule, work orders, chat, notifications, documents, materials, expenses and payee visibility.
23. Finish **#345/#429** participant UX/client wiring and direct/marketplace transitions.
24. Run mandatory two/three-independent-contractor sibling negatives and customer aggregate reads.
25. Connect GP2 and GP3 API + mobile-web suites only after the above is green.

### Wave 6 — lifecycle closure edges

26. Close **#319** governed permanent purge/retention/storage cleanup.
27. Close **#320** canonical authenticated native file save/share after #315.
28. Complete M07 supervisor, M08 viewer/revoke, M09 portal-token and M10 warranty/history through existing services; no new hubs.
29. Finish already-mandated simulated-provider tasks (A3/A4 and remaining simulated adapters) without real-provider activation.
30. Build/reconcile C1 controlled realistic data after participant/provider truth is integrated.

### Wave 7 — one integrated PRODUCT COMPLETE candidate

31. Finish A1/#337 executable GP files where absent; documentation may not make a test green.
32. Run **GP1–GP8 API + mobile-web** on one exact integrated SHA using canonical PostgreSQL + Redis + MinIO + API + Worker and simulated providers.
33. Run M01–M12 dispositions, including M11 response-loss and M12 A→B→A.
34. Run role/ACL negatives, error paths, reversal/recovery, native/file paths and finance/read-model reconciliation.
35. D1/#357 and D2/#358 close only from those results; E3/#362 publishes the same evidence rather than a separate readiness opinion.

## 9. PRODUCT COMPLETE exit gate

A PRODUCT COMPLETE claim is allowed only when all of the following hold simultaneously on one exact integrated SHA:

1. Every applicable critical Board cell is `PROVEN`; no critical cell remains `PARTIAL` or `BLOCKED`.
2. GP1–GP8 are green in API and mobile-web form on canonical PostgreSQL + Redis + MinIO + API + Worker with simulated providers.
3. M01–M12 have explicit tested disposition; M03, M11 and M12 are not waived.
4. Every replay-sensitive mutation has stable identity/version fencing before first retry; same intent converges and changed payload conflicts where required.
5. Customer/contractor/admin/portal authority is checked on the authoritative object before mutation and after relevant lock waits.
6. Every committed business mutation reconciles second-side visibility, linked calculations/read models, audit/outbox and worker effects without treating refresh failure as rollback.
7. Business reversal and restore/reconcile preserve audit/history; archive, trash and purge remain distinct.
8. Session/account switch prevents stale network/cache/storage/queue/file publication across generations.
9. Multi-contractor sibling isolation and customer aggregate views are proven.
10. Financial plan/revised/committed/actual/payment/receipt/refund states do not substitute for one another; unknown remains unknown.
11. Project/chat/document media bytes share the current authority boundary of their owning business object.
12. Candidate evidence is rerun after every prerequisite integration; stale old-base PR results are not counted as integrated truth.
13. Production-only external items may remain `FUTURE EXTERNAL`, but they are never represented as operational.

After this gate passes, remaining `FUTURE EXTERNAL` work is deployment/provider qualification rather than completion of the internal RENOVA product graph.
