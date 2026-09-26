# RENOVA — Product Completion & Ecosystem Mandate

**Статус:** ACTIVE / AUTHORITATIVE PRODUCT WORK PLAN.
**Редакция:** 2026-09-09.
**Подчинение:** `AGENTS.md` задаёт engineering policy; этот документ задаёт продуктовую модель, обязательные пользовательские результаты и порядок доведения до полноценно работающего продукта. `GOLDEN-PATHS.md` — исполняемые сквозные сценарии. `END-TO-END-GOVERNANCE.md` — обязательное правило изменения ТЗ. `MARKET-PRODUCT-BENCHMARK-2026-09-09.md` — рыночный research annex, не самостоятельный roadmap.

## 0. Цель и принцип продукта

RENOVA — не demo/MVP и не коллекция экранов. Целевой продукт — **единая операционная среда реального ремонта**, в которой заказчик и один или несколько независимых исполнителей проходят весь жизненный цикл объекта:

`вход → объект/комнаты → объём/смета → поиск и выбор исполнителей → scope/договор → график → работы → материалы → согласования → приёмка/доработка → деньги/чеки/споры/возвраты → документы → завершение → гарантия/архив`.

Главный invariant:

> Любая функция считается существующей только если пользователь может безопасно получить законченный бизнес-результат через обычный продуктовый путь, а система сохраняет правильную правду при повторе, плохой связи, смене аккаунта, конкурентных действиях, отказе background worker или внешнего provider.

**Demo/Test/Simulated** разрешены только как способ воспроизвести реальный продуктовый путь. Нельзя создавать отдельную упрощённую demo-бизнес-логику. Симулятор заменяет внешний provider за тем же port; всё остальное — auth/ACL, transaction, DB, DomainOutbox, reconciliation, read model, UI — обычное.

Живые ЮKassa, ФНС/НПД, Контур, Госключ, SMS/push и retail/finance providers в текущем мандате **не активируются**. Инфраструктура готовится так, чтобы подключение real adapter не требовало изменения доменной модели.

### 0.1. Критерий полного внутреннего завершения

Продукт может называться `PRODUCT COMPLETE ON CONTROLLED RUNTIME`, только когда одновременно:

1. все GP1–GP8 + G04/G05 в `GOLDEN-PATHS.md` зелёные на PostgreSQL canonical runtime;
2. customer и contractor проходят полный lifecycle без dev/admin обходов;
3. все критические mutation endpoints имеют определённые transaction/idempotency/replay/recovery semantics;
4. нет cross-account/cross-scope утечки состояния, queue intent, файлов или уведомлений;
5. money UI согласован с authoritative finance sources и не выдумывает fact;
6. один концепт имеет один canonical writer/state machine; retained compatibility path делегирует канону;
7. все planned product actions достижимы из canonical navigation или документированного external entry (portal/deeplink), без тупиков;
8. каждый critical screen имеет loading/empty/error/offline/stale/processing-or-queued/conflict/access-revoked/success, где применимо;
9. native file outcomes доказаны отдельно от web;
10. realistic datasets используют те же code paths, что обычный продукт;
11. living spec/roadmap/readiness соответствуют точному коду и evidence;
12. открытые external production blockers не переименованы в «готово».

Это **не** равнозначно `PRODUCTION VERIFIED`. Реальные provider/infrastructure/security/legal/store/pilot evidence остаются отдельным уровнем.

---

# 1. Неподлежащие ослаблению правила разработки

## 1.1. Работать от пользовательского результата, не от файла

До правки кода для каждой задачи фиксируется:

`persona → вход → намерение → authority → input → canonical service/state transition → transaction → authoritative data → side effects/outbox/provider → reconciliation → read model → UI/file result → notification → retry/recovery → audit/evidence`.

PR, который реализовал endpoint, кнопку или модель, но не замкнул применимую цепочку, не завершён.

## 1.2. Одна правда на концепт

Запрещено вводить второй самостоятельный:

- project/member source of truth;
- estimate/budget/spend source;
- acceptance state machine;
- material/purchase model;
- chat/message state;
- document/signature state;
- notification retry engine;
- provider-specific durable queue;
- navigation hub для того же продукта.

Compatibility route допустим временно, только если делегирует canonical service и имеет documented retirement/retention reason.

## 1.3. Ничего не удалять по названию или grep-count

Удаление функции/файла/route/alias выполняется только после repo-wide caller/route/deeplink/seed/test/docs scan и replacement proof. Миграции не переписываются. Legacy-named code может оставаться реальной зависимостью canonical layer; сначала переносится поведение, затем удаляется старое тело.

При сомнении — `LEGACY-RETAINED` + issue. Старые deeplink URL после UI consolidation должны вести на canonical destination, если compatibility contract ещё нужен.

## 1.4. Никакого ложного успеха или ложного провала

Каждая критическая пользовательская mutation завершается одним из явных outcomes:

- `committed` — authoritative transaction подтверждена;
- `queued` — intent durably сохранён локально и ещё не подтверждён сервером;
- `unknown_needs_reconcile` — отправка могла commit-нуться, но ответ потерян; повтор только с прежней stable identity или через authoritative read/reconciliation;
- `authoritative_refusal` — сервер подтвердил business/auth/validation/conflict отказ.

Падение refresh, websocket, navigation или последующего GET после `committed` не превращает commit в «не сохранено». UI сообщает «сохранено, не удалось обновить» и повторяет read/reconcile, а не business mutation.

## 1.5. Stable intent до первой сети

Для replay-sensitive операций `client_request_id`/business identity создаётся **до первой попытки отправки**, входит в сериализованный intent и переживает timeout, response loss, offline queue, restart/HMR. Same key + same canonical payload → исходный результат; same key + другой payload → conflict.

## 1.6. Session/actor generation

Каждая async operation захватывает `{actor_id, session_generation}`. Перед дополнительным network call, storage write, global state publish, navigation, cache publish или queue flush проверяется актуальность generation.

A→B→A — три разные session generations. Совпадение `actor_id` при возвращении к A не оживляет async completion первой A-сессии.

Logout немедленно инвалидирует local authority и пытается отозвать server refresh-session через canonical endpoint. При offline logout UI не утверждает, что server revoke выполнен.

## 1.7. Cache provenance

Cached result всегда несёт per-result provenance: как минимум `as_of`, `from_cache`, `stale`, `source/reason`. Cache fallback не обновляет timestamp свежести. Financial/approval UI не использует stale data как основание для необратимого действия без явной revalidation.

## 1.8. Finance truth

`Estimate ≠ Approved revised budget ≠ Commitment ≠ Purchase ≠ Expense ≠ Payment ≠ Receipt/Evidence ≠ Refund ≠ Change Order`.

UI может агрегировать, но обязан показывать происхождение и семантику. Запрещены формулы типа `max(...)` или подстановка plan как fact ради красивой диаграммы.

Целевая понятная пользователю проекция:

- **Исходный план** — первоначально утверждённая смета;
- **Утверждённый план** — исходный план + принятые change orders;
- **Обязательства** — подтверждённые заказы/договорные обязательства, где они моделируются;
- **Факт расходов** — только recognized Expense по каноническим правилам;
- **Оплачено** — cash movement/Payment, не синоним Expense;
- **Возвраты** — отдельная reverse economic truth;
- **Нет данных** — null/unavailable, а не искусственный 0.

## 1.9. Provider boundary

Domain code зависит только от port. Adapter знает API конкретного provider. Simulator реализует тот же contract. Provider operation должна быть идентифицируема, идемпотентна/reconcilable и не оставлять domain truth в полу-состоянии из-за timeout.

## 1.10. Specification same-change rule

Любое изменение поведения, роли, decision rights, entity/state, API, calculation, provider boundary, UI state, navigation, recovery, retention, security или evidence изменяет living spec/annex в том же PR.

---

# 2. Акторы и права

## 2.1. Customer — заказчик

Видит целостную картину своего проекта: объект, участников, все scopes, общий график, утверждённую смету/изменения, релевантные обязательства/факт/платежи, материалы, приёмку, документы, сообщения, гарантию.

Может создавать объект, выбирать/приглашать исполнителей, определять scope, согласовывать budget/schedule/selections/change orders, принимать/возвращать работу, инициировать/подтверждать предусмотренные продуктом платежные действия и споры, управлять своими документами/доступами.

Не получает автоматически admin/operator decision rights. В частности, submitter payment evidence не становится reviewer своего evidence.

## 2.2. Lead/general contractor

Опциональная координирующая роль. `Project.contractor_id`, где ещё сохраняется compatibility, не является полной картой участников. Lead не получает автоматически право читать sibling contractor commercial/private scope, если такой доступ не задан capability/contract.

## 2.3. Independent contractor principal

Самостоятельный участник проекта (`ProjectParticipant`) с явным scope. Может видеть и менять только разрешённые rooms/stages/work orders/material/commercial/document/chat surfaces. Удаление/reassignment прекращает будущую authority, но сохраняет исторические факты и audit.

## 2.4. Team member / viewer

Доступ наследуется только по явному relationship/capability и не расширяет principal scope. Read-only роль не может мутировать через скрытый deeplink/API.

## 2.5. Technical supervisor

Отдельная роль контроля качества/надзора с точным read/write contract; не получает права оплаты, управления участниками или подписи за стороны, если это явно не разрешено.

## 2.6. Admin/operator

Операционный контур: evidence review, reconciliation/DLQ/recovery и другие явно административные действия. Admin endpoint не превращается в обычный customer workaround.

## 2.7. Future ecosystem principals

Retailer/supplier, bank/finance provider, fiscal/signature provider — **не новые generic project users**. Они подключаются через scoped provider/partner contracts, минимальные data envelopes, consent/audit и не получают произвольный project ACL.

---

# 3. Полный пользовательский lifecycle заказчика

## C0. Регистрация, вход, сессии, устройство

**Путь:** phone → OTP provider port → session → project list/empty state.

Обязательно:
- OTP/rate-limit/session refresh/revoke/revoke-all;
- local secure token storage;
- session generation;
- logout local-first + server revoke attempt;
- expired/revoked session → controlled re-auth, без raw error;
- deeplink после login возвращается только в разрешённый canonical destination;
- account switch очищает/partition-ит state/cache/queue по actor;
- no cross-account offline replay.

## C1. Создание объекта

**Путь:** create project wizard → address/basic profile → rooms/floors/dimensions → project created atomically → canonical Object hub.

Обязательно:
- stable create identity;
- no fabricated local project before authoritative creation;
- room data validation;
- snapshot/change-log;
- archive/restore semantics;
- empty project leads к следующему понятному действию.

## C2. Планировка, помещения, расчёт объёма

**Путь:** room edit → persisted room → snapshot/change-log → material/estimate recalculation preview → explicit apply/approval path where needed.

Важно: изменение площади не переписывает молча утверждённый budget. Если изменение влияет на согласованный scope/cost, создаётся version/change workflow согласно domain contract.

## C3. Смета и бюджет

**Путь:** template/custom lines → estimate version → customer review → approved original plan → subsequent changes through Change Order.

Показывать:
- line/room/stage provenance;
- original vs revised plan;
- estimated vs committed vs actual vs paid;
- taxes/discounts/rounding where modeled;
- unknown facts как unavailable.

## C4. Поиск исполнителей и предложения

**Путь:** project need/lead → marketplace → 2+ quotes → compare price/scope/timing/reputation/evidence → select one or several participants → participant scope.

Обязательно:
- quote identity/version/status;
- only eligible contractor sees applicable lead;
- capacity policy under lock;
- one source-transition service for lead lifecycle;
- rejected contractor loses project access;
- selected contractor appears in participants and receives intended notifications;
- customer can add an external/invited contractor through canonical invitation path without pretending marketplace selection happened.

## C5. Участники и scopes

Customer screen: participants → role/principal → status → scope → commercial/document visibility → invite/change/remove.

Изменение scope revalidates future reads/writes/background recipients. Removal does not erase history. Shared project membership never grants sibling scope.

## C6. Договорённости, график и change control

**Путь:** scope + estimate → schedule/dependencies → approval → start authority.

Изменение после approval может затрагивать:
- scope;
- price;
- quantities/materials;
- stage dates/dependencies;
- contractor assignment;
- document version.

Система показывает impact before approval. Approved Change Order обновляет только определённые projections; история сохраняется.

## C7. Контроль выполнения

Customer видит:
- stage state и weighted progress;
- work orders;
- planned vs actual dates;
- dependencies/critical attention;
- photos/evidence;
- current assignee/principal;
- issues/rework;
- next action.

Не показывать progress, полученный из неподтверждённого UI-only state.

## C8. Материалы и выбор

`need → MaterialPick/selection → alternatives → customer approval/reject → purchase → delivery/partial delivery → return/replacement → receipt/expense`.

Selections/allowances market pattern адаптируется в текущую модель MaterialPick — второй selections SoT не создаётся.

Customer должен понимать:
- что нужно и для какого room/stage;
- сколько и когда;
- предложенный товар/аналог;
- цена/source/as-of;
- кто покупает/получает;
- что заказано/доставлено/возвращено;
- влияние на бюджет.

## C9. Приёмка и доработка

`submit → on_review → accept OR return(issue list) → rework SLA → resubmit → accept → acceptance document/warranty basis`.

Issue связан с конкретным stage/work/room/evidence. Старые acceptance compatibility routes не создают второй state machine. Portal-token decision проверяет exact resource/project/action, single-use/replay semantics.

## C10. Деньги

Поддерживаемые внутренние сценарии должны быть корректны до подключения real provider:

1. invoice/payment intent;
2. simulated platform checkout through PaymentProvider;
3. manual transfer + versioned evidence + authorized review;
4. recognized Expense;
5. receipt/fiscal verification through port;
6. dispute;
7. full/partial refund/reversal;
8. reconciliation after duplicate/out-of-order/ambiguous provider events.

Заказчик видит не только статус «оплачено», а полную историю: сумма, получатель/payee, основание stage/order, payment state, evidence/receipt status, dispute/refund.

## C11. Документы и подпись

`draft → version → review/approval → pending_signature → signatures → signed immutable version → superseding new version if changed → archive/export`.

Document access соответствует participant scope. Изменение подписанного content создаёт новую version. Provider signature result не считается подписанным до canonical verification/reconciliation.

## C12. Коммуникация, inbox, calendar

Chat thread привязан к project и при необходимости stage/work/scope. Участники видны пользователю. Message может породить task/invoice только через atomic/idempotent business command.

Inbox — не второй task database, а read model attention items с canonical deeplink. Calendar связывает реальные schedule/acceptance/payment/delivery/deadline events; экспорт ICS не меняет internal authority.

## C13. Завершение, гарантия, архив, удаление

Project closeout проверяет:
- открытые stages/issues;
- unresolved payments/disputes;
- pending materials/returns;
- required documents;
- warranty handover.

Archive скрывает active project, но не уничтожает data. Trash/purge obey retention/legal hold and full dependency graph. Purge failure — explicit refusal, не IntegrityError 500.

---

# 4. Полный lifecycle исполнителя

## E0. Регистрация и профиль

OTP/session как у customer. Contractor profile содержит только подтверждённые attributes; verified badge появляется только при authoritative evidence/provider status. NPD status позже приходит через provider port; simulator используется сейчас.

## E1. Поиск заказа и предложение

Contractor видит eligible leads по scope/location/category/capacity policy, открывает request, задаёт вопросы через разрешённый channel, отправляет quote с price/timing/scope. Quote update имеет version/lifecycle; customer получает сравнимую структуру.

## E2. Получение проекта

Selection/conversion atomically создаёт/обновляет participant/access, lead state, declined alternatives и notifications. Project selection/read не выполняет скрытое assignment.

## E3. Планирование своего scope

Contractor создаёт/редактирует разрешённые stages/work orders/schedule inputs; customer approval gates соблюдаются. Нельзя стартовать stage из-за «материалы готовы» или другого косвенного факта.

## E4. Работа на объекте

Field-first UX:
- открыть «что делать сегодня»;
- stage/work order detail;
- чек-лист/описание;
- фото/файл/evidence;
- progress/fact;
- issue/blocker;
- материал к закупке;
- отправить результат на review.

Плохая связь — normal condition. Queued action ясно отличается от committed. Фото/file intent не теряется и не публикуется чужой сессии.

**Рыночный кандидат T1:** lightweight Daily Progress Update агрегирует existing Stage/WorkOrder/Media/Activity, а не создаёт отдельный факт выполнения. Внедрять после core integrity и usability validation.

## E5. Материалы

Contractor видит только material needs своего scope; предлагает item/analog, получает approval, создаёт purchase в пределах authority, фиксирует цену/source, доставку/частичную доставку/возврат. Customer видит cross-project consolidated picture.

## E6. Сдача и rework

Contractor submit only after required evidence/conditions; видит return reasons/issues/SLA; resubmit preserves previous history. Accepted work immutable as historical decision; subsequent defect → warranty/claim, не переписывание acceptance.

## E7. Счёт/оплата/чек

Contractor invoice/payment request привязан к exact project/stage/work/payee. Duplicate submit/response loss безопасны. Fiscal receipt attachment/verification не создаёт второй Expense. Rejected evidence/receipt сохраняется history/version.

## E8. Документы

Contractor подписывает только документы, где он party/authorized signer. При нескольких независимых contractors документ связывается с нужным principal/scope, а не глобальным contractor_id.

## E9. Гарантия

Claim приходит только ответственному participant/scope; response/evidence/closure auditable. Removed contractor historical responsibility не исчезает автоматически.

## E10. Contractor business view — после core truth

После закрытия financial/source issues можно добавить proven profitability/pipeline view:
- quotes won/lost;
- contracted/revised value;
- recognized income where model exists;
- commitments/costs;
- margin only from explicit sources;
- overdue receivables/tasks;
- warranty burden.

Не создавать guessed profit из customer budget.

---

# 5. Cross-domain state and linkage requirements

## 5.1. Project

`active → archived → trash → purged` (конкретные enums сверяются с code). Restore before purge. Purge only through lifecycle service with retention/dependency/storage handling.

## 5.2. Participant

`invited/pending → active → changed-scope → removed/inactive`; immutable events track who changed access and why. Scope changes affect recipients, finance/docs visibility, files and background work.

## 5.3. Stage / WorkOrder

Plan, approved schedule, explicit start, progress, submission, review/rework, acceptance are distinct. WorkOrder belongs to authorized participant and scope.

## 5.4. Estimate / Change Order

Estimate version is plan proposal/approved baseline. ChangeOrder changes approved scope only after explicit decision. Rejected/draft change does not alter revised plan.

## 5.5. MaterialPick / Purchase / Supply

Need/selection/approval/purchase/delivery/return are distinct. `partial payment` and `partial delivery` may not share an ambiguous meaning; any existing overloaded status must be split or represented by separate quantitative fields before retailer integration.

## 5.6. Payment / Evidence / Receipt / Expense / Refund

Payment = cash flow state; Expense = recognized project cost; evidence/receipt = proof/fiscal object; refund = reversal. One economic event cannot increase spend twice.

## 5.7. Acceptance / Issue / Warranty

Acceptance decision is immutable event lineage. Rework issues remain attributable. Warranty begins from defined acceptance/completion basis and does not rewrite historical acceptance.

## 5.8. Document

Version content immutable after signed. Signature is actor+version+provider outcome. Export uses exact authorized project snapshot and must not include sibling-private files.

## 5.9. Chat / Task / Notification

Message truth, task truth and payment truth are separate entities linked atomically when created from message. Push/WS/inbox are delivery/read models; they do not own business state.

---

# 6. UX / navigation contract

## 6.1. Canonical primary areas

- **Главная** — current status + attention + next actions.
- **Сообщения** — project/scope communication.
- **Объект** — rooms/design/participants/project properties/documents where contextually appropriate.
- **Ремонт** — stages/work/schedule/acceptance/quality.
- **Бюджет / Деньги** — estimate/change/commitment/expense/payment/receipt/refund.
- **Сроки** — secondary calendar hub if retained by routeRegistry.

Secondary functions enter through canonical hub/deeplink. Duplicate top-level concepts are consolidated only with route/caller/deeplink proof.

## 6.2. Screen state matrix

Critical screens must define:

| State | UI rule |
|---|---|
| loading | skeleton/progress; no fake zero/empty |
| empty | explanation + one relevant next action |
| error | user-safe reason + retry/recovery |
| offline | what is available, what cannot be confirmed |
| stale | show as-of/provenance; restrict irreversible action if revalidation needed |
| processing | operation sent/known processing; prevent duplicate tap |
| queued | durable local intent, not server success |
| unknown/reconciling | do not repeat with new identity; check authoritative status |
| conflict/version | show changed data and deliberate resolve/retry |
| access revoked | clear sensitive state, canonical exit |
| success/committed | authoritative result + next action |

## 6.3. Design system

Use existing Theme/tokens/typography/shared components. Goal is not `0 Pressable` or `0 hex` mechanically; goal is no divergent business interaction where shared primitive exists. New raw styling/interaction requires justification. Touch target, safe area, keyboard, long Russian text, scaling/accessibility and one-hand field use are acceptance properties.

## 6.4. Dashboard principle

Один customer project cockpit и один contractor work cockpit derive from authoritative services/read models. Не создавать второй dashboard SoT. Attention items must deep-link to exact actionable object.

---

# 7. Provider and partner-ready architecture

## 7.1. Common adapter contract

Для каждого external capability:

`domain command → provider port → ProviderOperation durable identity → adapter/simulator → external result/webhook → inbox/verification → reconciliation → domain transition/outbox → user read model`.

Требования:
- stable idempotency key;
- provider external id mapping;
- timeout = unknown/reconcile, not blind new request;
- duplicate/out-of-order webhook safe;
- payload authenticity/expected amount/resource binding;
- secrets server-side only;
- bounded retry/DLQ/operator recovery;
- raw provider payload only where safe/needed, with retention/redaction;
- health reports mode/availability, not fictional verification.

## 7.2. PaymentProvider — YooKassa-ready

Prepare create/status/cancel/capture/refund where product needs them, idempotency, webhook verification and reconciliation. Real YooKassa adapter later. Domain state cannot depend on YooKassa-specific enum names outside adapter mapping.

## 7.3. FiscalReceiptProvider / NpdStatusProvider — FNS-ready

Receipt formation/verification/status are fiscal facts. Provider can be simulator now and authorized external mechanism later. Offline fiscal scenario is modeled explicitly; no «verified» until authoritative outcome.

## 7.4. ESignProvider — Kontur/Goskey-ready

Document version + signer intent remain internal. Adapter maps provider request/status. Госключ currently remains unimplemented until real integration work; do not expose provider-specific success beforehand.

## 7.5. Notification providers

SMS/push delivery status separate from business notification/inbox truth. Provider outage must not lose durable notification intent.

## 7.6. Storage/file provider

Authenticated file delivery, checksum/type/size, ACL, ambiguous write recovery, native save/share outcomes. Object key never grants authorization itself.

## 7.7. Future Retail ports — strategic T1

После внутреннего procurement truth:
- `CatalogProvider`: product/search/spec;
- `OfferProvider`: price/availability/as-of/region;
- `RetailOrderProvider`: reserve/order/status;
- `FulfillmentProvider`: shipment/delivery/partial delivery;
- `ReturnProvider`: return/replacement/refund reference.

Internal MaterialPick/Purchase remain authority; retailer object ids are external references.

## 7.8. Future Financing port — strategic T2

Only consented project snapshot → eligibility/offer/application/status. Credit decision/scoring stays with licensed financial partner. No bank-specific business model in core.

---

# 8. Рыночные усиления: правило принятия

`MARKET-PRODUCT-BENCHMARK-2026-09-09.md` вводит категории `ADOPT NOW / ADOPT LATER / WATCH / REJECT`.

Новая идея не становится задачей разработки, пока не заполнены:
1. source pattern;
2. exact RENOVA user problem;
3. role/outcome;
4. reuse map to existing domain;
5. no-duplicate proof;
6. Russian market fit;
7. failure/recovery model;
8. Golden Path/evidence;
9. owner priority decision.

High-confidence patterns:
- connected customer cockpit;
- contractor scoped workspace;
- Original/Revised/Committed/Actual/Cash finance projection;
- selections linked to procurement;
- defects/acceptance linked to location/evidence;
- offline field correctness;
- immutable document/audit «golden thread».

Later candidates:
- structured daily progress update;
- contractor profitability;
- plan annotations/as-built;
- retailer ports;
- financing port;
- AI assistants with human confirmation.

---

# 9. Ordered implementation plan

Порядок определяется зависимостями и risk, **не календарными неделями**. P0 product-integrity всегда выше визуальной полировки и ecosystem expansion.

## Phase 0 — Integrity floor (existing governed issues; implementation PRs use `Mandate ID: hotfix` unless separately mapped)

### I1 · #315 · Session/account/queue isolation — P0 prerequisite

- session generation at auth context;
- fence refreshProjects/loadProject/token refresh/storage/cache/navigation;
- remove/retire implicit assignment-on-read after caller proof;
- explicit project-load outcome;
- actor-owned offline queue;
- logout local invalidate + server revoke attempt;
- A→B, A→B→A, competing project load, delayed promise, storage failure, old refresh completion tests.

**Exit:** no operation started in generation N can publish/mutate using authority from N+1; queue A never executes as B.

### I2 · #316 + PR #322 · Mutation idempotency inventory

PR #322 is bounded chat invoice/task candidate, not whole closure. Inventory every queued/retryable mutation, classify risk and implement stable intent + server ledger/transaction for money/work/state changes where needed.

**Exit:** lost response/retry cannot create duplicate business effect for any operation allowed into durable automatic replay.

### I3 · #317 · Transport/offline/cache truth

Central error classification; enqueue reachable from normalized network/timeout failures only when server operation is replay-safe; result-level cache provenance; no global last-cache metadata.

### I4 · #305 · Committed-vs-refresh interaction truth

Systematically apply outcome contract to purchases/materials/acceptance/docs/payments/tasks. Prevent second tap/new request identity after acknowledged commit.

### I5 · #318 · Budget truth

Exact sum-preserving allocation; explicit period/as-of; timezone/date tests; actual category facts from ledger or unavailable; no plan-as-spent.

### I6 · #319 · Project lifecycle/purge/retention

Full graph incl participant scopes/events, documents/media, finance, outbox/operations, retention hold, storage cleanup/retry. No raw FK IntegrityError.

### I7 · #320 · Canonical native file delivery

Chat PDF first confirmed gap; reuse canonical authenticated abstraction. Validate PDF/content, session fence, cancellation/unavailable share/cleanup, web regression, iOS/Android evidence.

**Phase 0 gate:** G04 + G05 executable and green for affected paths; no retry expansion before I1/I2.

---

## Phase A — Provider-independent integration foundation

Historical IDs retained to preserve PR/issue traceability.

### A1 · Executable Golden Paths

GP1–GP8 API + mobile-web tests. Failing step must identify real blocker, not be silently skipped. G04/G05 are cross-cutting recovery suites.

### A2 · Provider ports/registry

Foundation already landed via governance lineage; extend only from real capability needs. No direct provider calls from domain after migration tasks.

### A3 · Simulated PaymentProvider lifecycle

Persistent/restart-safe `create → pending → success/cancel → refund`, webhook through same internal processing path, failure/timeout/out-of-order modes. Dev transition endpoint local/test only and fail-closed elsewhere.

### A4 · Migrate payment/subscription domain to port

Direct YooKassa service dependency removed from canonical domain paths with compatibility re-export only where proven necessary. Payment-domain idempotency/money semantics live outside adapter.

### A5 · Fiscal/NPD simulators and ports

Deterministic valid/not_found/mismatch/timeout/rate-limit. Replace business-use of stubs/demo branches with port, not with another special-case.

### A6 · Notification/e-sign simulators

SMS/push delivery receipts and in-app signature use same durable contracts as future providers.

### A7 · Provider modes/runtime policy

`off | simulated | real`; simulated permitted only controlled local/test; staging/production fail closed according to current policy; real requires credentials/config. `/health`/`/ready` report mode and truthful status.

**Phase A gate:** providers can be swapped at adapter layer in contract tests; no real credentials/transactions.

---

## Phase B — Product truth and multi-contractor model

### B1 · Scoped visibility everywhere

ProjectParticipant scope enforced on stages/work orders/schedule/materials/finance/docs/chat/notifications/files. Customer aggregate view; sibling contractor isolation; background recipient calculations use same authority.

### B2 · Participant UX

Customer manages participant lifecycle/scope. Contractor «мои проекты» derives from participant authority. Invite/marketplace conversion are separate origins feeding same participant model.

### B3 · Canonicalize legacy writers/routes

Project create/assignment/budget/acceptance/navigation compatibility analyzed one by one. Delete only duplicate bodies after callers moved and equivalence tests. `budget_service_legacy.py` is not deleted merely by name; migrate dependencies first. Acceptance routes that delegate canonical service may stay as compatibility until removal proof.

### B4 · Contractor capacity policy

One capacity decision under lock across create/assign/conversion/accept-quote paths; race tests.

### B5 · Marketplace source transitions

One JobLead transition service with explicit state table, locks and notifications; exactly one winner under concurrency.

**Phase B gate:** GP2/GP3 operate with customer + at least two independent contractors; sibling negative tests green.

---

## Phase C — Complete customer/contractor experience

### C1 · Canonical realistic datasets

Not one pretty demo only. Maintain at least:
- clean/new user;
- active mid-project with 2+ contractors;
- stressed project (overdue, overrun, dispute, rework, partial delivery);
- near-complete/closed+warranty project.

Datasets are idempotent and use ordinary services/transactions. Financial totals reconcile.

### C2 · Customer cockpit

Progress, revised budget/fact, nearest events, attention items, unresolved approvals/rework/disputes/material risk, next actions. Every card opens exact canonical target.

### C3 · Budget/Money UX

Original → Revised → Committed → Actual → Paid/Refunded projection, category/stage drill-down → entity/payment/receipt/evidence. Explicit unavailable state. #318 must be closed first.

### C4 · Schedule and calendar

Canonical schedule with dependencies/critical attention and explicit edit authority. Existing view-only assumption is not permanent if real user workflow requires date changes: update uses canonical stage/work-schedule mutation, validates dependency conflicts, requires approval/change path when contractual date is affected. Calendar remains secondary projection, not second schedule truth. ICS native/web export.

### C5 · Acceptance/quality/warranty UX

Full submit → issues → rework → resubmit → accept → warranty. All issues tied to scope/location/evidence. Portal entry tested.

### C6 · Documents lifecycle UX

Container refactor only if behavior preserved. User can see versions, signers, pending action, signed immutable content, superseded version, export/archive. Native file outcome where applicable.

### C7 · First-use/empty/recovery UX

Clean database both roles. Each empty state has one meaningful next action; permissions/errors/offline/stale/conflict/revoked state matrix covered.

### C8 · Reproducible product showcase

`demo:web`/presentation shell may exist only as presentation wrapper around ordinary runtime + controlled dataset. `EXPO_PUBLIC_DEMO` cannot authorize, bypass provider/domain state, create fake success or change calculations. Showcase script declares what is simulated externally.

**Additional C-lifecycle requirements embedded, not separate duplicate tasks:**
- room edit → snapshot/change log → recalculation → explicit impact;
- material analog/reject/approval paths;
- document new-version path;
- participant/thread visibility;
- stage payment progress;
- customer-visible outcome of authorized payment-evidence review;
- canonical files/share;
- calendar upcoming/deep links.

**Phase C gate:** every Customer C0–C13 and Contractor E0–E9 scenario has reachable UI or documented external entry and no known P0/P1 product dead end.

---

## Phase D — End-to-end proof

### D1 · GP1–GP8 green API + mobile-web

No allowed-to-fail. Real PostgreSQL/Redis/MinIO/API/worker controlled topology. Simulated providers through ports only.

### D2 · Negative/security/business paths

At least two meaningful negative cases per GP plus cross-project/sibling-scope, revoked participant/session, validation/conflict and forbidden deeplink where applicable.

### D3 · Recovery/concurrency paths

Duplicate/out-of-order provider event, timeout after commit, worker crash, retry, DLQ/replay, offline cold start, A→B→A, partial file/provider outcome, stale cache, competing state transitions.

**Visual/native evidence:** key Golden Path screens on small/normal iPhone viewport for loading/empty/error/offline/stale/processing/conflict/revoked/success; native file/device capability separately labeled. Screenshot is evidence of UI state only, not business correctness.

---

## Phase E — Consolidation and readiness truth

### E1 · CI consolidation

Consolidate only with old→new job coverage proof. Never reduce checks or weaken fail-closed gates to simplify workflow count.

### E2 · Documentation archive

Historical audits/waves moved to archive with HISTORICAL markers. Canonical docs remain discoverable and non-duplicative.

### E3 · Readiness truth

`PRODUCTION-READINESS.md` + JSON expose product completeness, provider modes and exact evidence. External blockers remain open until external evidence exists.

### E4 · Repository/legal metadata

LICENSE/ownership selected by owner. No implied open-source license by accident.

---

# 10. Strategic T1/T2 after core completion

These are **not ready implementation tasks** merely because competitors have them.

## T1 — product-market strengthening

1. Lightweight Daily Progress Update on existing Stage/WorkOrder/Media/Activity.
2. Contractor profitability/pipeline from canonical finance facts.
3. Retail catalog/offer/order/delivery/return ports.
4. Verified contractor attributes/reputation backed by completed project/evidence.
5. Richer selections/alternatives/allowances within MaterialPick.
6. Plan annotations/as-built tied to room/stage/issue if usability research proves need.

## T2 — ecosystem expansion

1. FinancingProvider + bank partner flow with consent/minimal snapshot.
2. Deep retail/EDI integrations.
3. Partner APIs/reporting for consented aggregated/project data.
4. AI assistants: summary, draft estimate/scope, anomaly hints — human confirmation required; never authoritative.

Перед переводом T1/T2 в ready применяется market adoption gate §8.

---

# 11. Definition of Done каждого implementation PR

1. Mandate/issue scope конкретен и bounded.
2. Affected end-to-end chain записана реальными файлами/services/entities.
3. Authority/ACL/resource scope определены.
4. State transition и source of truth определены.
5. Transaction boundary определена.
6. Idempotency/replay behavior определены даже если операция declared non-retryable.
7. Concurrency/race risk проверен.
8. Offline/timeout/response-loss semantics определены.
9. Outbox/provider/reconciliation behavior определены.
10. UI outcomes/state matrix определены.
11. Audit/history/notification behavior определены.
12. Removal proof при удалениях.
13. Focused + full relevant CI green на exact candidate; passed identity/baseline не деградирует.
14. PostgreSQL evidence для DB race/migration/locking.
15. Affected Golden Paths/negative/recovery tests обновлены.
16. Living spec/contract обновлены в том же PR.
17. External verification status не завышен.
18. Found P0/P1 out-of-scope gap зарегистрирован issue, а не оставлен TODO/chat.
19. Second-agent review там, где требует governance.
20. Merge только owner/reviewer после exact-head qualification.

---

# 12. Обязательный рабочий цикл усовершенствования приложения

Это правило применяется к **любой** будущей просьбе «улучшить», «добавить», «как у X», «сделать удобнее», даже если идея кажется очевидной.

## Шаг 1 — Source truth

Проверить актуальные main/open PR/issues/current spec, реальную registered route/service/entity/UI implementation. Не считать audit snapshot более свежим, чем code.

## Шаг 2 — User problem

Сформулировать: `кто → в какой ситуации → чего хочет добиться → какой terminal result`. Если нет terminal result, feature не проектируется.

## Шаг 3 — Existing capability reuse

Найти, что уже существует. Улучшать canonical model, а не заводить параллельную сущность/экран/сервис.

## Шаг 4 — Lifecycle and decision rights

Перечислить состояния, переходы, actor, approver, revocation, historical retention. Нельзя менять decision rights случайной UI-кнопкой.

## Шаг 5 — Data/financial truth

Определить authoritative source, provenance/as-of, null semantics, currency/rounding/status treatment. Для денег — recognition rules.

## Шаг 6 — Reliability

Определить transaction, stable intent, retry, concurrency, offline, response loss, provider ambiguity, reconciliation and recovery.

## Шаг 7 — UX

Canonical entry point, no duplicate hub, state matrix, long Russian text, accessibility, small screen, next action, files/deeplinks.

## Шаг 8 — Ecosystem/security/privacy

Что увидят другие contractors/partner/admin? Какие consent/data minimization/retention constraints? External provider only through port.

## Шаг 9 — Acceptance before implementation

Сначала добавить/уточнить Golden Path/domain contract/test case; затем code. Если идея market-inspired — заполнить §8 benchmark gate.

## Шаг 10 — Bounded implementation

Один authoritative writer; same-change spec; no unrelated refactor.

## Шаг 11 — Proof

Focused → PostgreSQL where relevant → full CI → E2E → negative/recovery → visual/native where relevant. Статус доказательства пишется точно.

## Шаг 12 — Post-merge reconciliation

Only after merge: update issue/readiness, rebase dependent work, requalify stale candidates. Foundation does not auto-close full product issue.

---

# 13. Второй агент / red-team review

Reviewer независимо:

- воспроизводит evidence;
- проверяет affected chain;
- повторяет removal/caller proof;
- проверяет provider boundary;
- проверяет scope/ACL/IDOR;
- проверяет «commit был, refresh упал»;
- проверяет duplicate/retry/concurrency;
- называет минимум одну гипотезу «что ещё может сломаться» и проверяет её;
- подтверждает отсутствие нового demo/legacy SoT;
- выдаёт `APPROVE` или `CHANGES_REQUESTED`.

Автор не заменяет second-agent review своим повторным чтением.

---

# 14. Что этот мандат сознательно не объявляет завершённым

До отдельной внешней квалификации остаются независимыми:

- real staging/deployment/promotion;
- managed backup/PITR/DR;
- external observability delivery/alerts;
- load/capacity/provider degradation;
- independent pentest/security exercises;
- real provider reconciliation and ambiguous S3/provider writes;
- main branch protection/ruleset external state;
- controlled pilot/product telemetry/support operations;
- legal/privacy/terms/subprocessors/retention approvals;
- TestFlight/App Store/Google Play release;
- real YooKassa/FNS/Kontur/Goskey/Twilio/retail/bank transactions.

`IMPLEMENTED`, `TESTED`, `CI VERIFIED`, `STAGING VERIFIED`, `EXTERNALLY VERIFIED`, `PRODUCTION VERIFIED` не взаимозаменяемы.

---

# 15. Журнал конфликтов/решений

| Дата | Конфликт | Решение |
|---|---|---|
| 2026-09-09 | Старый план ставил provider foundation раньше подтверждённых #315–#319 integrity gaps | Введён Phase 0 Integrity floor; исторические A1–E4 IDs сохранены для traceability |
| 2026-09-09 | C4 описывал schedule как view-only, хотя полноценный продукт должен уметь изменять реальные даты при наличии backend contract | Правило: редактирование допускается через canonical schedule mutation + dependency validation + approval/change impact; calendar остаётся projection |
| 2026-09-09 | C8 назывался web-demo и использовал demo env, что могло быть понято как отдельная business logic | Presentation shell разрешён только поверх обычного runtime; demo flag не может менять auth/domain/finance/provider outcome |
| 2026-09-09 | Анализ предлагал customer review payment evidence | Сохранены действующие decision rights: evidence review только authorized reviewer, пока отдельное product/security решение не изменит модель |
| 2026-09-09 | Анализ предлагал удалять legacy routes/files по названию | Удаление только после delegation/caller/deeplink/equivalence proof; compatibility routes могут оставаться временно |

Агент, обнаруживший новый конфликт между мандатом, `AGENTS.md`, кодом и живым ТЗ, записывает его в этом журнале в том же PR. Если разрешение меняет business behavior/decision rights — не решает его молча.
