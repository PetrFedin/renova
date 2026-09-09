# RENOVA — журнал изменений и план завершения продукта

**Срез:** 2026-09-09, canonical main `e5c6ee44c0f684b14037e77948dbcb630fd41896` на момент governance-сверки.
**Статус:** `BLOCKED_FOR_BROAD_PRODUCTION`; internal product completion продолжается.
**Канон порядка работ:** `PRODUCT-COMPLETION-MANDATE.md`.
**Сквозная приёмка:** `GOLDEN-PATHS.md` + `USER-JOURNEY-CATALOG.md`.
**Рынок/стратегические кандидаты:** `MARKET-PRODUCT-BENCHMARK-2026-09-09.md` + `MARKET-COMPETITOR-PROFILES-2026-09-09.md` + `RUSSIAN-MARKET-ECOSYSTEM-BENCHMARK-2026-09-09.md`.
**Полный source audit:** `PRODUCT-COMPLETENESS-AUDIT-2026-09-08.md`.

Обязательный исторический governance-токен, проверяемый machine contract: **наблюдение → решение → код/данные → тест → evidence → следующий шаг**.
Расширенный рабочий цикл: **наблюдение → issue/decision → bounded code → same-change specification → test/evidence → post-merge reconciliation → следующий зависимый шаг**.

Никаких календарных ETA/процентов готовности без принятого release scope, команды и внешних условий. Приоритет определяется risk/dependency/terminal user result.

---

## 0.1. Historical machine-contract compatibility markers

Следующие строки сохраняются дословно, потому что `scripts/technicalSpecContract.test.mjs` использует их как continuity markers старого roadmap. Они **не задают текущий порядок работ** и не должны интерпретироваться как повторное открытие уже пройденных волн; текущий порядок определяется разделом 2 и `PRODUCT-COMPLETION-MANDATE.md`.

- `P0.1. Закрыть canonical local runtime end-to-end` — historical lineage локального runtime; foundation интегрирован через #288, внешняя среда остаётся отдельной readiness-границей.
- `P0.2. Полная native PostgreSQL enum parity` — historical lineage enum/schema parity; migration chain w16–w22 сохраняется и проверяется текущими schema gates.
- `P1.1. Полный screen contract inventory` — historical lineage screen inventory; текущая более строгая цель — классифицировать каждый user-visible route/action в `USER-JOURNEY-CATALOG.md` и доказать terminal result.

---

## 1. Уже интегрировано, но не равно полной готовности

| Изменение | Evidence / merge lineage | Остаточный scope |
|---|---|---|
| #288 canonical local runtime/agent context | merge `7bd1dceb273a7e1f26ddf2333e9199d8d498ae54` | external staging/production |
| #290 logical restore | run `33344103969`, merge `748ed5f22db0bfe18001f276ec521d0198d4dc57` | managed backup/PITR/RPO/RTO |
| #292 ordinary chat message atomicity | merge `9d3f96bad6138aef7f7db32407162fe07897572d` | other mutations/offline/session/native file |
| #295 warranty creation | merge `9fed24c1b59d767daef4d6395fd01cb303c838e3` | full post-closeout/provider/device lifecycle |
| #297 manual payment evidence | merge `389f35d819dbf0b81d2e821da851fa9a647705d2` | provider/storage ambiguity and full money UX |
| #309/#310 material supply/start truth | migration `w20materialsupply01` | granular partial delivery/payment semantics |
| #311 material price provenance | merge `85f8d279d393b42bae5d76fea333f9d13c8ae0b5`, `w21materialprice01` | retailer/live offer integration later |
| #312 participant foundation | merge `38657631348ea7bbe9a22cd5d631cb4ddba0250e`, `w22projectparticipants01` | full #300 domain/mobile adoption |
| #313 participant management + atomic marketplace conversion | candidate `ae8a0750...`, merge `65ddb7e59e6bcb23473b1017686cd3adbd882187` | scoped reads/writes/payees/docs/chat/capacity/source transitions |
| #314 quoted-lead wizard recovery | candidate `6e88a1d...`, merge `95dd4a8e117289df11e1300891490768c22f585f` | shared context/session #315 |
| #323 governance/provider-port foundation | main lineage through `e5c6ee44...` | provider migration/simulators remain A3–A7 |

PR #322 (`582fd727...`) is a **qualified but still open** bounded #316 candidate for chat invoice/task atomicity and replay. Until reviewed/merged it is not main truth and does not close all #316.

---

## 2. Current ordered internal product priorities

### P0 / integrity floor

1. **#315 — session/account/queue fencing.** Session generation, A→B→A, token refresh ownership, project load fencing, queue actor ownership, logout server revoke attempt.
2. **PR #322 review/merge + remaining #316 inventory.** No automatic retry expansion until target operation is replay-safe.
3. **#317 — transport/offline/cache provenance.** Normalize network/timeout/retry classification; per-result freshness truth.
4. **#305 mutation truth slice.** Commit acknowledged + refresh failed must remain committed; systematic outcome contract.
5. **#318 finance presentation truth.** Period sum conservation, explicit as-of/timezone, actual/unavailable category facts.
6. **#319 purge/retention graph.** Full project dependency graph and recoverable storage cleanup.
7. **#320 native authenticated file delivery.** Chat PDF first confirmed gap, canonical abstraction + session fence.

### Product model completion

8. **#300 / B1–B5.** Full independent-contractor scopes across stages/work/materials/finance/docs/chat/files/notifications + participant UX + capacity/source transitions + safe legacy canonicalization.
9. **A3–A7 provider abstraction.** Simulators/ports/modes/migrate domain away from direct provider calls; no live providers.
10. **C1–C8 customer/contractor experience.** Controlled datasets, customer cockpit, finance projection, schedule/calendar, acceptance/warranty, documents, first-use/recovery UX, presentation shell over ordinary runtime.
11. **D1–D3 proof.** GP1–GP8 + G04/G05, negative/concurrency/recovery/native/visual evidence.
12. **E1–E4 consolidation.** CI/docs/readiness truth/repository metadata.

### Strategic T1/T2 only after core acceptance

- lightweight daily progress update;
- contractor profitability/pipeline;
- retailer-neutral catalog/offer/order/delivery/return ports;
- verified contractor attributes/reputation;
- richer selections/allowances within MaterialPick;
- plan annotations/as-built;
- FinancingProvider;
- partner APIs;
- AI assistants with human confirmation.

T1/T2 are not `ready` merely because analogues implement them. Use market adoption gate from Mandate §8.

---

## 3. Product acceptance map

| Layer | Required result |
|---|---|
| GP1 | Object/rooms/estimate/budget with plan truth |
| GP2 | Marketplace/quotes/participant conversion/multi-contractor access |
| GP3 | Stages/schedule/start/work orders/evidence |
| GP4 | Submission/rework/acceptance/warranty |
| GP5 | Invoice/payment/receipt/evidence/dispute/refund/reconciliation |
| GP6 | Material need/selection/purchase/delivery/receipt/expense |
| GP7 | Document/version/signature/archive/export |
| GP8 | Chat/inbox/push/reminders with scope |
| G04 | Unstable network/response loss/restart/queue replay |
| G05 | Account/session switch A→B→A |
| User Journey Catalog | Granular C/E actions + secondary surfaces + multi-contractor negatives + recovery catalog |

Product feature is DONE only when requirement → entry/role → service/entity → state/transaction → UI result → test → exact evidence is traceable.

---

## 4. External production work remains independent

- #247 main protection/required checks external state;
- #233 production-like staging/exact artifact promotion;
- #235/#283 external observability delivery/alert/ACK;
- #234 managed backup/PITR/DR;
- #236 capacity/load/provider degradation;
- #256/#257/#237 access review/pentest/security acceptance;
- #238 provider authoritative reconciliation/S3 ambiguous writes;
- #241 controlled pilot/telemetry/support/legal/privacy.

Internal product work may prepare architecture for these, but repository CI alone does not close them.

---

## 5. Provider integration order when owner allows real activation

До команды владельца real adapters remain inactive.

When activated later, order is:

1. provider contract/adaptor tests against sandbox;
2. secret/config runtime preflight;
3. webhook authenticity and idempotency;
4. ambiguous timeout/reconciliation;
5. staging exact-artifact flow;
6. negative/duplicate/out-of-order tests;
7. controlled transaction/evidence;
8. external readiness update;
9. only then user-facing `VERIFIED` claims.

Potential providers: YooKassa → FNS/NPD → Kontur/Goskey → notification → retailer → financing, but actual order follows business priority/legal readiness, not this illustrative list.

---

## 6. Market-informed product position

RENOVA target is not marketplace-only and not heavy enterprise ERP:

`trusted renovation graph = contractor discovery + multi-principal scope + estimate/change + field execution + materials + acceptance + money + documents + warranty`.

Market patterns already adopted into plan:
- customer cockpit;
- scoped contractor workspace;
- Original/Revised/Committed/Actual/Cash projection;
- selections linked to procurement;
- defects linked to room/stage/evidence;
- field-first offline correctness;
- immutable document/audit lineage;
- retailer/bank/state integrations through controlled future ports.

Russian benchmark separately confirms the value of stage acceptance/payment control, technical supervision, retail fulfillment and later bank financing boundaries without moving those external services into current core.

See benchmark annexes for evidence and `ADOPT NOW/LATER/REJECT` decisions.

---

## 7. Current governance change

Issue #365 / PR #366 reconcile source-truth user journeys and rewrite the canonical completion model. Scope is documentation/governance only; it does not itself fix #315–#320/#300 or activate providers.

After PR #366 exact-head CI + independent review + owner merge, subsequent implementation branches use this Mandate order. Until merge, main remains authoritative and PR #366 is candidate specification.
