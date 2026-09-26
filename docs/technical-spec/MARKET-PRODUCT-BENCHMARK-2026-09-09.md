# RENOVA — рыночный benchmark и продуктовые принципы

**Статус:** ACTIVE RESEARCH ANNEX / вход в Product Completion Mandate, не самостоятельный roadmap.
**Дата сверки:** 2026-09-09.
**Правило использования:** наличие функции у аналога не является основанием копировать её в RENOVA. Любая рыночная идея проходит product-fit gate из `PRODUCT-COMPLETION-MANDATE.md`: пользовательский результат → роль/право → существующий домен → жизненный цикл → финансовая/данная правда → recovery/offline → UX → тесты/evidence. До этого идея имеет статус `BENCHMARK HYPOTHESIS`.

## 1. Что сравнивалось и граница исследования

Исследование охватывает репрезентативные классы продуктов, а не претендует на исчерпывающий каталог всего рынка:

1. **Home renovation / contractor operating systems:** Houzz Pro, Buildertrend, JobTread.
2. **Construction management / field execution:** Procore, Fieldwire.
3. **Российский marketplace специалистов:** Профи.ру.
4. **Российская retail/construction ecosystem:** Петрович / Петрович B2B / ПроПетрович.
5. **Российская инфраструктура будущих интеграций:** ЮKassa, ФНС/НПД, Контур Диадок. Реальное подключение в текущий Product Completion Mandate запрещено; изучаются только контракты и архитектурные требования.

Официальные источники, использованные для сверки:

- Houzz Pro Features — https://pro.houzz.com/for-pros/houzz-pro-features
- Houzz Pro release notes — https://pro.houzz.com/pro-release-notes
- Buildertrend — https://buildertrend.com/builder-software/
- Buildertrend Warranty — https://buildertrend.com/project-management/construction-warranty/
- JobTread — https://www.jobtread.com/
- Procore — https://www.procore.com/commercial
- Fieldwire — https://www.fieldwire.com/
- Профи.ру — https://profi.ru/about/ и https://profi.ru/
- Петрович B2B — https://b2b.petrovich.ru/
- ПроПетрович — https://pro.petrovich.ru/
- ЮKassa API — https://yookassa.ru/developers/api
- ЮKassa idempotency/webhooks — https://yookassa.ru/developers/using-api/interaction-format и https://yookassa.ru/developers/using-api/webhooks
- ФНС НПД — https://www.nalog.gov.ru/ (официальные материалы по формированию и передаче чеков)
- Контур Диадок API — https://developer.kontur.ru/doc/diadoc-api/index.html

Любые характеристики ниже относятся к состоянию официальных материалов на дату сверки и не заменяют юридическую/коммерческую due diligence партнёра.

---

## 2. Вывод рынка: где должна находиться RENOVA

RENOVA не должна становиться «ещё одним marketplace мастеров» и не должна пытаться быть тяжёлой ERP для генерального подрядчика. Наиболее сильная позиция:

> **единая доверенная операционная среда реального ремонта жилья, связывающая заказчика, несколько независимых исполнителей, объём работ, график, материалы, приёмку, деньги, документы и гарантию в один доказательный проектный граф.**

Это соединяет сильные стороны нескольких классов систем:

- marketplace discovery и репутацию — как у российских сервисов поиска специалистов;
- связанный customer/contractor project cockpit — как у Houzz Pro / Buildertrend / JobTread;
- финансовую трассируемость и change control — как у зрелых construction-management систем;
- field-first фото/задачи/offline — как у Fieldwire;
- document/version/quality «golden thread» — как у Procore;
- российские fiscal/signature/payment/retail boundaries — как локальное конкурентное преимущество.

Ключевой дифференциатор — **не ширина меню, а доказуемая непрерывность результата от намерения до принятой, оплаченной и документированной работы**.

---

## 3. Сравнение продуктовых паттернов

| Паттерн рынка | Примеры | RENOVA сейчас | Решение |
|---|---|---|---|
| Lead → предложения → выбор | Профи.ру, Houzz Pro, JobTread | marketplace + quotes + atomic conversion существуют | **KEEP / COMPLETE:** multi-contractor, capacity, source transitions, scoped access |
| Единый клиентский кабинет проекта | Houzz Pro Client Dashboard, Buildertrend Client Portal | несколько hub-ов + dashboard foundation | **ADOPT NOW:** один attention-driven cockpit без второго dashboard SoT |
| Отдельное ограниченное пространство подрядчика/субподрядчика | Houzz Pro, Buildertrend, JobTread | ProjectParticipant foundation | **ADOPT NOW:** #300/B1/B2, scope во всех доменах, sibling isolation |
| Estimate → revised budget → commitments → actual → payments | Buildertrend/Houzz Pro/Procore | estimate/change orders/expense/payment есть, presentation truth неполна #318 | **ADOPT NOW:** явно показывать Original / Approved / Committed / Actual / Cash, не смешивая сущности |
| Change orders | Houzz Pro, Buildertrend, JobTread, Procore | реализованы approval/change-order основы | **COMPLETE:** влияние на бюджет/график/договор, history + notification |
| Selections/allowances | Houzz Pro, JobTread | MaterialPick/design approvals частично пересекаются | **ADAPT:** не создавать новый parallel model; усилить MaterialPick как выбор → альтернатива → согласование → закупка → факт |
| Purchase orders / procurement tracking | Houzz Pro, JobTread, Buildertrend | Purchase/PurchaseItem/material supply | **COMPLETE:** partial delivery/return/replacement, retailer-ready offer/order boundary |
| Daily logs / structured site updates | Houzz Pro, Buildertrend, JobTread | фото/chat/activity есть, отдельный структурированный daily-log SoT не подтверждён | **CANDIDATE AFTER CORE:** лёгкий дневной отчёт исполнителя поверх существующих Stage/WorkOrder/Media, без нового параллельного журнала фактов |
| Punch list / defects linked to location | Fieldwire, Procore | acceptance issues/rework/rooms/stages | **ADOPT NOW AS LINKING:** issue → room/stage/work/photo/evidence; не создавать второй defects domain |
| Plan markup / as-built | Fieldwire, Procore, Houzz Pro | floor plan/picture foundations | **LATER:** после GP1–GP8; useful but не блокирует core completion |
| RFI/submittals | Procore/Fieldwire | approvals/chat/documents частично покрывают смысл | **DO NOT COPY MODULE:** при потребности моделировать как typed request/approval на текущих сущностях |
| Warranty | Buildertrend | warranty claims atomic foundation | **RENOVA STRENGTH:** связать с acceptance, contractor, documents, evidence и handover |
| Offline field work | Fieldwire | очередь/cache есть, но #315–#317 открыты | **P0 PRODUCT REQUIREMENT:** correctness first, затем UX polish |
| Job profitability / margin | Houzz Pro/Buildertrend | customer budget есть; contractor profitability SoT не подтверждён | **CANDIDATE:** после financial truth; только из доказанных доходов/обязательств/расходов, не guessed margin |
| Time tracking | Houzz Pro/JobTread | полноценный контур не подтверждён | **LATER / optional contractor module:** не нужен для customer core, но полезен подрядчикам при подтверждённом спросе |
| Financing | Houzz Pro/JobTread | provider boundary отсутствует как продуктовый contract | **ECOSYSTEM CANDIDATE:** financing eligibility/offers port; никакого собственного кредитного скоринга сейчас |
| Retail/material ecosystem | Петрович B2B | material demand/procurement уже сильный домен | **STRATEGIC:** provider-neutral catalog/offer/order/delivery/return interfaces after internal procurement truth |
| Verified identity/reviews | Профи.ру | user/marketplace/reviews foundations требуют отдельной source audit | **ADAPT CAREFULLY:** verified attributes + completed-project evidence; не создавать недоказанный badge |
| Document version + traceability | Procore | document/version/signature/audit foundations | **ADOPT NOW:** immutable signed version, version lineage, handover archive |
| AI estimate/update assistants | Houzz Pro | не core | **LATER:** только assistive draft/summarization; AI никогда не становится authority денег, приемки, статуса или права |

---

## 4. Что RENOVA уже делает лучше как целевая архитектура

### 4.1. Один граф реального ремонта вместо набора SaaS-инструментов

Целевой RENOVA chain:

`Object/Room → Estimate → Scope/Participant → Stage/WorkOrder → Material need/selection/purchase → Evidence → Acceptance/Rework → Payment/Receipt/Refund → Document/version → Warranty → Archive`.

Преимущество возникает только если каждая связь существует в authoritative data и видима пользователю. Ссылка в UI без доменной связи не считается преимуществом.

### 4.2. Несколько независимых исполнителей

Для российского ремонта типичны разные principals: электрик, сантехническая бригада, плиточник, дизайнер, HVAC, общий подрядчик. RENOVA должна уметь показывать заказчику **единый объект**, а каждому исполнителю — только свой scope и свою коммерческую/документную ответственность. Это сильнее модели «один project contractor + его внутренняя team».

### 4.3. Доказательная приёмка

Сдача, замечания, фото, возврат на доработку, повторная сдача, акт, гарантия должны быть одной lineage. Для пользователя это не «quality module», а ответ на вопрос: **что было обещано, что реально сделано, что принято, кем, когда и с какими доказательствами**.

### 4.4. Российская financial/fiscal readiness

RENOVA должна различать внутреннюю финансовую правду и внешнюю fiscal/payment truth. ФНС требует формирование и передачу НПД-чека; ЮKassa использует idempotency-key и webhook lifecycle. Поэтому текущая работа над durable intent/idempotency/reconciliation — не техническая косметика, а необходимая основа локального продукта.

---

## 5. Целевая ценность для участников экосистемы

### Заказчик

- один понятный статус объекта вместо чатов/таблиц/переводов в разных местах;
- сравнение исполнителей по предложению и доказанной истории;
- контроль scope, сроков, материалов и изменений;
- деньги с объяснимым `план → утверждено → обязательства → факт → оплачено`;
- фото/приёмка/замечания/гарантия;
- документы и архив проекта;
- recovery при плохой связи без повторных оплат/задач.

### Исполнитель

- лид → предложение → подтверждённый scope → график → work orders → материалы → сдача → деньги → документы → гарантия;
- меньше ручного администрирования и споров о том, «что было договорено»;
- scoped collaboration с заказчиком и другими исполнителями без выдачи лишнего доступа;
- в перспективе: job profitability, лёгкие site logs, повторные клиенты и reputation from completed evidence.

### Ритейлер / поставщик

RENOVA ценна не витриной товаров, а **структурированным спросом, привязанным к реальному проекту**:

`room/stage need → approved selection → quantity → required-by date → offer → order → delivery → return/replacement → receipt/warranty`.

Это позволяет в будущем дать партнёру provider-neutral интерфейсы каталога, цены/остатка, резерва, заказа, доставки и возврата. Петрович B2B публично показывает рыночную ценность комплектации объектов, электронной фиксации поставки, индивидуального ценообразования, кредитования, доставки по времени и возвратов; RENOVA может стать demand/orchestration layer, не копируя retailer ERP.

### Банк / финансовый партнёр

Потенциальная ценность — **consent-based verified project facts**, а не собственный кредитный скоринг RENOVA:

- утверждённый бюджет и change orders;
- график и milestones;
- участники/договоры;
- фактические признанные расходы и платежи;
- спор/возврат/приёмка;
- completion evidence.

Будущий financing port может передавать минимально необходимый consented snapshot и получать offer/status. Решение о кредите остаётся у финансовой организации; RENOVA не делает regulatory scoring без отдельного проекта.

### Государство / инфраструктурные партнёры

Потенциальная ценность — структурированная, трассируемая хозяйственная операция:

- participant identity/role/scope;
- readiness к НПД/fiscal чековым событиям;
- электронные документы и подписи через адаптеры;
- audit trail и immutable versions;
- consent, retention/export/delete boundaries.

Это не означает автоматическую передачу проектных данных государству. Любая такая интеграция требует отдельного legal/privacy basis.

### Инвестор

Инвестиционно интересный актив — не количество features, а:

1. **transaction graph:** repair lifecycle со связанными объектами и событиями;
2. **multi-sided network:** customer + contractors + retail + finance/provider ecosystem;
3. **repeatable trust layer:** scope, change, acceptance, money, documents, warranty;
4. **integration leverage:** provider swap via ports/adapters;
5. **data moat with consent:** фактические сроки/стоимость/качество/материалы на уровне структурированного проекта, а не scraped content;
6. **monetization optionality:** contractor subscription/lead economics, partner commerce, payments/financing referrals — только после unit-economics и legal validation.

---

## 6. Российский market-fit: что обязательно

1. **Нестабильная мобильная связь — normal case**, а не edge case. Offline intent/replay must be correct.
2. **Несколько независимых исполнителей** в одном объекте — first-class requirement.
3. **Прямые и платформенные оплаты** должны сосуществовать без подмены Payment/Expense/Receipt.
4. **НПД/чек** — отдельная fiscal truth, не просто фото квитанции.
5. **Документы/акты/подпись** должны иметь immutable version lineage и provider-neutral signature boundary.
6. **Материалы** должны учитывать цены, остатки, сроки поставки, частичную поставку, возвраты и замену.
7. **Телефон-first UX** с длинными русскими формулировками, плохой связью и минимумом действий на объекте.
8. **Поддержка спора и восстановления**, а не только happy path.
9. **Privacy/ACL** между независимыми подрядчиками: коммерческие и персональные данные sibling scope не раскрываются.
10. **Юридические/внешние claims fail-closed:** пока интеграция не проверена, UI и readiness не говорят «проверено ФНС/подписано Госключом/оплачено ЮKassa».

---

## 7. Strategic adoption queue

### T0 — обязательно для полного текущего продукта

- session/offline/idempotency correctness (#315–#317);
- money presentation truth (#318);
- safe purge/retention (#319);
- native authenticated files (#320);
- truthful committed-vs-refresh UX (#305);
- complete multi-contractor #300;
- customer/project cockpit from authoritative attention data;
- selections/materials linked to procurement and budget;
- change order impact across scope/budget/schedule/docs;
- acceptance defects linked to room/stage/work/evidence;
- full document version/signature/archive chain.

### T1 — усиливает product-market fit после T0

- lightweight structured Daily Progress Update built on Stage/WorkOrder/Media/Activity;
- contractor project profitability using canonical financial sources;
- retailer-neutral catalog/offer/order/delivery/return ports;
- verified contractor attributes backed by actual evidence/status provider;
- richer selection alternatives/allowances without a parallel material model;
- plan annotations linked to existing rooms/stages/issues if usability validation confirms value.

### T2 — ecosystem expansion after full internal product proof

- financing offers/provider integration;
- deeper EDI/retail procurement integrations;
- AI-assisted summaries, estimate drafts, scope extraction and risk hints with human confirmation;
- portfolio/enterprise analytics for contractors/partners;
- bank/retail/state partner APIs with explicit consent/scopes/rate limits/audit.

### Reject / do not build now

- a second demo business backend;
- a second budget/acceptance/material/chat source of truth;
- generic enterprise safety/RFI modules copied only because Procore has them;
- AI-autonomous approval, pricing, payment, acceptance or contractor selection;
- proprietary credit scoring;
- raw partner data sharing without explicit consent/legal basis;
- vanity feature counts or route-count targets.

---

## 8. Benchmark acceptance rule for future work

Any proposal inspired by another product must include in its issue/PR:

1. **Source pattern:** what user problem the analogue solves; URL/date.
2. **RENOVA problem:** concrete current user journey gap, not «competitor has it».
3. **Reuse map:** which existing RENOVA entities/services/screens are extended.
4. **No-duplicate proof:** why no second SoT/state machine is introduced.
5. **Russian fit:** roles, legal/fiscal/payment/material context if relevant.
6. **Value:** customer / contractor / retailer / bank / state / investor impact; only relevant stakeholders.
7. **Failure model:** offline, retry, revoke, conflict, provider unavailable, partial result.
8. **Evidence:** exact acceptance test and affected Golden Paths.
9. **Decision:** `ADOPT NOW | ADOPT LATER | WATCH | REJECT`.

Without these nine fields the idea remains research and may not enter implementation.
