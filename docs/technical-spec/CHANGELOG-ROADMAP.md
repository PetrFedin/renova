# Renova — журнал изменений и актуальный план завершения продукта

**Статус:** ACTIVE / LIVING ROADMAP  
**Дата сверки:** 2026-09-16  
**Канонический `main`:** `e5c6ee44c0f684b14037e77948dbcb630fd41896`  
**Broad production:** `BLOCKED_FOR_BROAD_PRODUCTION`  
**Оперативный статус:** `PRODUCT-COMPLETION-BOARD.md`  
**Системный контракт:** `../RENOVA-TECHNICAL-SPECIFICATION.md`

Этот roadmap больше не является статическим списком задач. Он отражает **dependency-aware integration order**. Если новый подтверждённый P0 меняет порядок, roadmap и Completion Board обновляются в той же logical change.

Канон работы:

`наблюдение → issue/contract → bounded candidate → exact evidence → owner integration → descendant requalification → product E2E → следующий blocker`.

---

## 1. Что уже находится в каноническом main

Исторически интегрированы и остаются частью продукта, но сами по себе не означают полной готовности:

- local runtime foundation;
- logical restore foundation;
- ordinary chat message atomicity;
- warranty create primitive;
- manual payment evidence primitive;
- material supply/readiness + explicit stage start foundations;
- price provenance;
- ProjectParticipant foundation `w22projectparticipants01`;
- participant management + atomic marketplace conversion foundations;
- quoted-lead wizard recovery foundation.

Текущий `main` остаётся `PARTIAL`: более новые security/recovery/finance/lifecycle fixes живут в candidate PRs и не считаются интегрированными до merge + requalification descendants.

---

## 2. Ключевые bounded candidates на 2026-09-16

### Integration/governance/runtime

- #425 — protected-main/bootstrap prerequisite; exact candidate qualified.
- #389 — backend image PCRE2 remediation on #425 lineage.
- #372 — bounded npm remediation on #425 lineage.
- #437 — required PR-context scheduling on #425 lineage.
- #450 — bounded canonical infrastructure pull retry on #425 lineage.

### Security/data authority

- #444 — estimate-line PATCH path/project binding.
- #424 — calendar stage/project binding.
- #452 — stage reaction Project→Stage→Comment binding.
- #455 — project-media ACL.
- #456 — chat attachment/thread ACL, stacked on #455.
- #441 — floor-plan/pin/furniture binding remains PARTIAL due required PG evidence/integration gap.

### Finance/calculation truth

- #382 — sum-preserving period allocation + unavailable category actual.
- #381 — explicit actual-zero truth in its bounded domain; integrate/requalify with affected producers.

### Replay/recovery

- #322 — chat invoice/task atomicity and response-loss replay prerequisite.
- #414 — design-package create replay primitive: CANDIDATE PROVEN bounded.
- #416 — selection create replay primitive: CANDIDATE PROVEN bounded.
- #418/#459 — issue-create replay primitive: CANDIDATE PROVEN bounded.
- #460/#465 — material-needs replay primitive: CANDIDATE PROVEN bounded.
- #383 direct WorkOrder, #392 chat-thread, #404 stage-comment, #412 estimate-create — useful evidence but still PARTIAL pending comparable integrated qualification.
- #385 reaction replay / #387 intent-aware queue dedupe — important stacked prerequisites, not #316 completion.
- #461 iCalendar atomic/replay — evidence/integration pending.

### Connected domain lifecycle

- #448 — Change Order decision/replay/conflict bounded lifecycle.
- #457 — reversible estimate-line remove/restore bounded lifecycle; candidate schema `w23estimatelifecycle01`, not canonical-main schema.
- #434/#438/#440 — project/room lifecycle foundations/evidence.
- #458 — integrated GP1 draft; chain explicitly pending, no GP promotion.

### UX/review

- #367 — public review branch; role/project entry and deployed mutation proof succeed, but full Chromium/WebKit product smoke is red.
- #408 — truthful materials commit-vs-refresh UX candidate.
- #391/#393/#395/#397/#403/#405/#407/#410/#411 — bounded interaction/navigation/accessibility candidates, mostly old-base or pending requalification.

---

## 3. Действующий integration DAG

### Wave 0 — восстановить доверенный integration path

**Цель:** последующие P0 должны квалифицироваться на каноническом, защищаемом, воспроизводимом main lineage.

1. Owner review/merge #425.
2. Rebase/requalify #389 на новый `main`; owner review/merge.
3. Rebase/requalify #372; owner review/merge.
4. Rebase/requalify #437.
5. Rebase/requalify #450.
6. Проверить live repository ruleset/protection #247; source config/green CI не заменяет live admin evidence.

**Gate:** все required checks реально schedulable; canonical local runtime проходит; image/dependency blockers не скрыты; descendants знают новый base.

### Wave 1 — security и data authority

1. Refresh/requalify #444, #424, #452.
2. Довести #441 до требуемого PostgreSQL proof и requalify.
3. Refresh/requalify #455 → затем #456.
4. Выполнить targeted sibling/cross-project mutation/read scans по estimate/media/docs/finance/chat/materials/work/schedule.
5. Любой найденный IDOR/security corruption становится выше replay/UX задач.
6. Refresh/requalify #381/#382 вместе с affected producers/read models.

**Gate:** object id нельзя использовать вне уже авторизованного owner project/thread; unknown facts не подменяются plan/zero.

### Wave 2 — replay и atomicity

1. Refresh/review/merge #322 первым.
2. Rebase всех stacked #322 children на resulting main.
3. Интегрировать #387 как conservative intent-dedupe prerequisite.
4. Exact-requalify mutation slices: #385, #383, #392, #404, #412, #414, #416, #418, #460.
5. После calendar authority + recovery foundation квалифицировать #461.
6. Повторить executable #431 mutation inventory.
7. #316 закрывается **только если нет reachable mutation family с unsafe response-loss/offline replay или split transaction**.

**Gate:** stable intent до первой попытки; same intent converges; changed payload conflicts; precommit failure rolls back; commit+lost-response безопасно replay.

### Wave 3 — session/offline/cache

1. #315 global session/account generation fence.
2. #317 transport classification + durable enqueue reachability + cache provenance.
3. A→B→A delayed-response matrix.
4. Project1→Project2 delayed-response matrix.
5. Airplane→mutation→restart→reconnect across queued families.
6. Old-account queue/token/storage/cache/file result never publishes under current account.

**Gate:** G04/G05-class behavior is safe globally, а не только в одном screen-local fence.

### Wave 4 — GP1 first connected lifecycle

1. Refresh/requalify #434 project lifecycle.
2. Refresh/requalify #438/#440 room lifecycle and consume server room authority in UI.
3. Bring #444/#412/#457 onto same current estimate lineage.
4. Integrate #448 Change Order lifecycle.
5. Integrate/reconcile #382 finance calculation truth.
6. Rebuild #458.
7. Run connected GP1 API + mobile-web:
   `project → rooms → estimate → change → budget → second-side → reversal → response-loss retry`.

**Gate:** GP1 only changes to PROVEN after one exact SHA passes full connected chain.

### Wave 5 — multi-contractor / GP2 / GP3

1. Close #300/#344 scope adoption across stages/schedule/workorders/chat/notifications/docs/materials/expenses/payee.
2. Complete participant client/UX after #429.
3. Prove two/three independent contractors cannot read/write sibling scopes.
4. Prove customer aggregate view remains correct.
5. Connect marketplace conversion to participant authority.
6. Run GP2 API/mobile-web.
7. Run GP3 API/mobile-web with schedule/workorders/evidence/progress.

**Gate:** no half-supported multi-contractor configuration remains exposed. If a configuration is not supported yet, it must fail closed rather than silently leak legacy `contractor_id` semantics.

### Wave 6 — lifecycle edges

1. #319 full project purge/retention/storage graph.
2. #320 authenticated native file save/share after #315.
3. Unified closeout → archive → history → warranty → warranty closure.
4. Complete supervisor/viewer/portal-token lifecycles.
5. Complete required simulated provider lifecycles without enabling real providers.
6. Reconcile deterministic realistic demo data.

**Gate:** finished project remains usable as history/warranty object and destructive operations preserve mandated evidence/retention.

### Wave 7 — Human Usability Closure

No new major product domains.

1. Customer Home: status / needs your decision / 7 days / plan-fact-forecast / top risk.
2. Contractor Home: today / overdue / blocked / waiting customer / ready to submit / money.
3. Stable top-level navigation; no unpredictable phase-driven dock movement.
4. Object: Rooms / Estimate / Drawings & Design / Object Data.
5. Estimate: Summary / Lines / Changes / Documents.
6. `Change Order` user label → `Дополнительные работы`.
7. Stage becomes aggregate execution container.
8. Materials: `Нужно → Согласовано → Заказано → Доставлено`; approved ≠ ordered.
9. Schedule: Today / 2 weeks / Whole project + causal delays.
10. Inbox is sole attention queue; approvals detail; chat context.
11. Unified acceptance/issue/warranty UX.
12. Documents simplified; technical exports moved under integrations.
13. Contextual quick actions.
14. Full accessibility/navigation pass.
15. Role-by-role friction retirement.

**Gate:** all canonical functions discoverable and operable without hidden product knowledge; browser smoke 100% green in Chromium and WebKit.

### Wave 8 — final internal PRODUCT COMPLETE candidate

1. Freeze one exact candidate SHA.
2. GP1–GP8 API + mobile-web on PostgreSQL + Redis + MinIO + API + Worker.
3. Customer×contractor concurrent run.
4. Offline/slow/timeout/response-loss/conflict/reversal/account-switch run.
5. Required iOS/Android key paths.
6. Deterministic two-project review seed.
7. Security/data/calculation/migration/restore evidence pack.
8. Any change after qualification → new candidate SHA + affected rerun.

### Wave 9 — external production qualification

Parallel where ownership/resources allow, but never used to hide internal blockers:

- persistent staging / exact artifact promotion;
- managed PITR/restore + measured RPO/RTO;
- alert delivery/ACK/recovery;
- load/ramp/spike/soak;
- independent security/pentest;
- legal/privacy;
- real provider qualification;
- controlled pilot/support/incident process.

---

## 4. Deployed review acceptance state

Last checked deployed product run: `35084701908` on #367 lineage.

Passed:

- customer project 1 entry;
- customer project 2 entry;
- contractor project 1 entry;
- contractor project 2 entry;
- deployed mutation proof job.

Failed Chromium product smoke (6 of 10):

1. customer management-dashboard destination;
2. contractor market-estimate discoverability/contract;
3. overlay intercepting customer dock/Home;
4. customer Object tab `aria-selected` state;
5. contractor Home restoration/readiness;
6. contractor Object/Rooms discoverability.

WebKit product job also failed.

Therefore review = `PARTIAL/BLOCKED`, not completed product. Fixes must change either runtime behavior or, only when proven stale, the explicit contract/test; failing assertions are not rewritten to current output merely to produce green.

---

## 5. Как автоматически определить «что делать дальше»

At task start:

1. Refresh Board evidence cut.
2. Find highest-risk `BLOCKED` row whose prerequisite is available.
3. If prerequisite waits for owner/external action, choose next independent row of equal/higher risk rather than bypassing it.
4. Work the smallest closed lifecycle slice, not the largest file set.
5. Record baseline.
6. Implement + exact tests.
7. Update Board/roadmap/spec in same logical change.
8. If candidate is green: `CANDIDATE PROVEN` only for proven bounded cells.
9. After merge: requalify descendants; then and only then promote main evidence.
10. Recompute next priority.

Priority order:

`security/data/money corruption → atomicity/recovery → session/offline/cache → calculation truth → browser/native correctness → lifecycle/multi-party → usability → external → new features`.

---

## 6. Нельзя считать готовностью

- presence of source/UI/API;
- green unit test without business chain;
- old green after new SHA;
- stale-base candidate;
- one browser instead of matrix;
- SQLite instead of mandatory PostgreSQL race;
- cache shown as fresh;
- unknown shown as zero;
- invoice shown as payment;
- approved shown as ordered;
- simulator shown as live provider;
- user notification shown as durable audit history;
- foundation merge shown as closure of parent issue;
- deleting/changing failing test because current UI differs without proving the contract changed.

---

## 7. Final acceptance

PRODUCT COMPLETE requires simultaneously:

- zero launch-blocking internal P0;
- GP1–GP8 PROVEN one SHA;
- critical mutation surfaces closed;
- M01–M12 explicit tested dispositions;
- customer/contractor browser matrix green;
- required native paths green;
- session/account isolation;
- offline/retry/reversal;
- finance/calculation reconciliation;
- multi-contractor isolation;
- media/document ACL;
- migration + restore evidence;
- closeout/archive/warranty/history;
- truthful provider status;
- immutable release evidence.

No subjective completion percentage or launch ETA is maintained without agreed weighting/resources/external prerequisites. The number of closed end-to-end cells matters more than the number of features added.
