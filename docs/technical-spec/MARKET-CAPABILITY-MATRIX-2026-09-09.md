# RENOVA — cross-category market capability matrix

**Status:** ACTIVE RESEARCH ANNEX / вход в Product Completion Mandate.
**Дата сверки:** 2026-09-09.
**Принцип:** это не список функций к копированию. Каждая строка — продуктовый паттерн и решение `USE NOW | ADAPT | LATER | REJECT AS DUPLICATE | EXTERNAL`. Реализация допускается только через lifecycle из `PRODUCT-COMPLETION-MANDATE.md`.

---

## 1. Карта классов аналогов

| Класс | Репрезентативные продукты | Что у них изучаем | Роль относительно RENOVA |
|---|---|---|---|
| Российский end-to-end ремонт | Домклик Ремонт, Петрович.Ремонт, сервисы Лемана ПРО/«Руки» | этапы, договор, приемка, оплата, гарантия, материалы | прямой локальный benchmark отдельных цепочек |
| Российский marketplace | Профи.ру, YouDo, ПроПетрович | постановка задачи, отклики, trust/reputation, safe-deal pattern | benchmark discovery/trust |
| Residential contractor OS | Houzz Pro, Buildertrend, JobTread, Contractor Foreman, Buildxact, BuildBook | клиентский кабинет, schedule, selections, financials, change control | benchmark project operating model |
| Field/construction | Procore, Fieldwire, PlanRadar | defects, evidence, plans, versions, permissions, handover | benchmark quality/golden thread |
| Field photo evidence | CompanyCam | timestamp/location photo graph, annotations, timeline/report | benchmark доказательной фиксации |
| Floor plan / estimating | magicplan | plan → quantities/scope/estimate | benchmark object/calculation continuity |
| Service/trade OS | Jobber, ServiceTitan | quote → job → schedule → invoice/payment; contractor economics | benchmark compact lead-to-cash |
| Retail/procurement | Петрович B2B, Лемана ПРО | catalog/offer/order/delivery/return/service bundling | future partner boundary |
| Regulated infrastructure | YooKassa, ФНС/НПД, Контур/Госключ, банки | payment/fiscal/signature/financing lifecycle | future external adapters only |

Исследование репрезентативное: цель — покрыть основные product archetypes, а не заявить исчерпывающий каталог всех приложений мира.

---

## 2. Сравнительная capability matrix

Обозначения: `●` сильный/центральный паттерн; `○` есть ограниченно/не основной акцент; `—` не является центральной публичной функцией. Для RENOVA `TARGET` означает целевую функцию, а не доказанную готовность.

| Capability | Marketplace RU | Домклик/retail service | Residential OS | Field platforms | Evidence/plan tools | RENOVA TARGET |
|---|---:|---:|---:|---:|---:|---:|
| Lead / поиск исполнителя | ● | ● | ○ | — | — | ● |
| Quotes / сравнение условий | ● | ○ | ● | — | — | ● |
| Несколько независимых principals в одном объекте | ○ | ○ | ○ | ● enterprise | — | **● first-class scoped** |
| Customer cockpit | ○ | ● | ● | ○ | ○ | **● attention-driven** |
| Estimate / budget | ○ | ● | ● | ● | ● magicplan | ● |
| Change order / версия согласованного бюджета | — | ● contractual | ● | ● | — | **●** |
| Schedule / dependencies | ○ | ● stage plan | ● | ● | — | ● |
| Work orders / tasks | ○ | ○ | ● | ● | ○ | ● |
| Daily progress | — | ○ | ● | ● | ● CompanyCam | `ADAPT` over existing facts |
| Фото с доказательным контекстом | ○ | ○ | ● | ● | **● CompanyCam** | **● linked evidence** |
| Defects / punch / rework | — | ● | ○ | **●** | ○ | **● acceptance lineage** |
| Plan markup / location binding | — | — | ○ | ● | ● | `LATER` after core |
| Selections / material decisions | — | ○ | **●** | ○ | ○ | **● via MaterialPick** |
| Procurement / PO | — | ● retail | ● | ○ | — | ● |
| Partial delivery / return | — | ● retail | ○ | ○ | — | **● internal truth before adapters** |
| Acceptance before payment | ○ safe deal | **● Домклик** | ○ | ○ | — | **● domain rule where contract requires** |
| Invoice / payment | ○ | ● | ● | ● finance | ○ | ● provider-neutral |
| Fiscal/NPD receipt | marketplace-specific | — | — | — | — | **● Russian port** |
| Document versions/approvals | ○ | contractual | ● | **●** | ○ | **● immutable lineage** |
| Signature | ○ | contractual | ● | ● | ○ | ● provider-neutral |
| Warranty / aftercare | ○ | ● | ● | handover/defects | — | **● acceptance-linked** |
| Client permissions | ○ | ○ | ● | ● | ○ | **● scope+capability** |
| Offline field correctness | generic mobile | generic mobile | ○ | **●** | ● | **● P0 integrity** |
| Contractor profitability | — | — | ● | ● | — | `LATER` |
| Retail fulfillment | — | **●** | ○ | — | — | `LATER` provider-neutral |
| Financing | ○/external | bank-linked | ○/● in some products | — | — | `LATER` FinancingProvider |
| Audit / handover archive | ○ | contractual | ● | **●** | ● reports | **●** |

---

## 3. Паттерны, которые RENOVA должна принять в core

### 3.1. CompanyCam: фото должно быть фактом проекта, а не вложением

Official: https://companycam.com/features

Публичные паттерны CompanyCam: timestamp/location photo capture, annotations, project timeline, customer/subcontractor sharing, comments, tags, documents/PDF reports, checklists/tasks and signatures.

**RENOVA ADAPT NOW:**
- media всегда привязано к `project + room/stage/work/issue/acceptance` где применимо;
- сохраняются actor/time/server receipt/provenance;
- defect/rework может ссылаться на конкретное evidence;
- customer progress feed является projection этих фактов, а не вторым журналом;
- shared gallery/report показывает только authorized subset.

**LATER:** annotations/LiDAR/AI summary. AI не меняет acceptance fact.

### 3.2. magicplan: объект → расчет без ручного разрыва

Official: https://help.magicplan.app/estimate-plan

magicplan связывает floor plans с расчетом materials/labor/scope и item libraries.

**RENOVA ADAPT:** существующий `Room/FloorPlan → deterministic calculation → EstimateLine/MaterialNeed` должен иметь provenance/version. Изменение геометрии не должно молча переписывать утвержденный baseline: оно создает новый расчетный snapshot и, если затрагивает approved scope/budget, проходит change workflow.

### 3.3. BuildBook: клиентский кабинет должен быть управляемым по видимости

Official client dashboard: https://help.buildbook.co/en/articles/10030030-client-dashboard
Official selections: https://help.buildbook.co/en/articles/10029678-selections-overview

BuildBook показывает клиенту updates, calendar, chat, tasks, financials, invoices, selections и files с configurable permissions. Selection allowances и фактическая стоимость связаны с budget.

**RENOVA ADAPT NOW:**
- не копировать отдельный client portal SoT;
- строить customer cockpit из текущих authoritative domains;
- visibility определяется server capability/scope;
- MaterialPick + Estimate/ChangeOrder дают selection impact, без второго budget;
- due material decision становится attention item и может влиять на schedule risk.

### 3.4. Jobber: минимальный lead-to-cash должен быть коротким

Official client hub: https://www.getjobber.com/features/client-hub/
Official quote flow: https://help.getjobber.com/en/articles/quote-basics/

Публичный Jobber flow: request/quote approval → job/appointment → invoice → payment/receipt в client hub.

**RENOVA ADAPT:** для небольшого standardized scope путь исполнителя должен быть короче, чем полный капитальный ремонт, но использовать те же authoritative entities. Нельзя создавать отдельную «быструю» demo/business модель. Instant/simple job — это параметр/упрощенный UX существующего flow.

### 3.5. PlanRadar: issue должен иметь location/evidence/assignee/deadline/closure

Official task management: https://www.planradar.com/product/task-assignment/
Official document/version management: https://www.planradar.com/product/construction-document-management/

PlanRadar связывает tasks with plan location, comments/photos, assignee/deadline/status, on-site quality check, reports; documents have permissions, approvals, versions and audit trail.

**RENOVA ADAPT NOW:**
- acceptance/rework issue связывается с room/stage/work/evidence;
- responsible principal, severity, due/SLA and closure evidence explicit;
- document version/approval timestamp immutable;
- plan location link может быть добавлен позже как optional coordinate, не новый defect domain.

---

## 4. Российские паттерны, которые особенно важны

### Домклик Ремонт
Official: https://domclick.ru/my-home/promo/remont

Публично описан этапный flow: деньги резервируются для очередного этапа; исполнитель отмечает этап готовым; заказчик принимает или оставляет замечания; после принятия этапа деньги переводятся исполнителю. Это подтверждает product value связки `stage readiness → review/rework → payment eligibility`, но RENOVA не реализует собственное escrow/hold до отдельного регулируемого provider/legal проекта.

### YouDo
Official example: https://youdo.com/

Публичный паттерн: задание → отклики → выбор по отзывам → чат → завершение; для поддерживаемых сценариев — «Сделка без риска», возврат/компенсация и verified attributes. Для RENOVA это означает evidence-backed identity/reputation и provider-owned safe-deal later, а не decorative badges.

### Лемана ПРО / сервис «Руки»
Official rules: https://lemanapro.ru/pravila/uslugi/pravila-okazaniya-uslug-po-remontu-i-ustanovke/

Правила прямо разделяют retailer/subagent, сервис и независимого мастера; договор работ заключается между клиентом и мастером; деньги перечисляются мастеру после выполнения; приемка и список недостатков оформляются документально, что важно для гарантии.

**RENOVA lesson:** participant/principal, contract party, payee and retailer/service intermediary — разные роли. Нельзя выводить payee или legal responsibility только из `Project.contractor_id`.

### Петрович
Official B2B: https://b2b.petrovich.ru/
Official ecosystem/services: https://petrovich.ru/services/

Публичные B2B capabilities: object supply, individual pricing/credit, timed delivery, electronic delivery confirmation, returns. Design flow связывает room dimensions, visualization, estimate, order and delivery.

**RENOVA lesson:** retailer adapter должен получать structured approved demand, но Purchase/Expense/project requirement остаются RENOVA truth.

---

## 5. Что не нужно копировать сейчас

1. Enterprise safety/RFI/submittal modules только ради Procore parity.
2. Второй CRM поверх marketplace/project graph.
3. Второй selections/material model.
4. Второй task/defect domain ради терминологии аналога.
5. Retail catalog как внутренний master RENOVA.
6. Собственный банковский underwriting/credit score.
7. Собственное escrow/reserved-funds хранение без legal/provider contour.
8. AI auto-approval, auto-payment, auto-acceptance или auto-financial fact.
9. LiDAR/BIM/plan markup до закрытия core mobile/session/offline/finance truth.
10. Vanity dashboards без user action and source/as-of.

---

## 6. Приоритетная продуктовая дифференциация RENOVA

1. **Один customer-owned renovation graph** на весь объект.
2. **Несколько независимых исполнителей** с изоляцией scopes и сохранением общей картины заказчика.
3. **Evidence-first acceptance**: обещано → сделано → доказано → замечание/rework → принято.
4. **Financial truth**: Original → Revised → Commitment → Actual → Payment → Receipt → Refund.
5. **Materials truth**: need → selection → offer → purchase → payment → delivery qty → return/replacement → receipt/warranty.
6. **Russian provider readiness** без provider-specific business truth.
7. **Offline/session correctness** как конкурентное качество field-продукта.
8. **Handover/warranty continuity**, а не обрыв продукта после оплаты.
9. **Partner-ready consented graph** для retail/bank/state без выдачи им общего project membership.
10. **Investment story based on transaction depth**, а не на количестве экранов.

---

## 7. Gate для любой market-inspired функции

Market evidence → конкретная проблема RENOVA → существующий domain reuse → role/scope/decision rights → state machine → finance/data effect → offline/retry/session behavior → Russian legal/provider boundary → UX states → tests/evidence → bounded PR.

Если хотя бы одно звено не определено, функция остается `BENCHMARK HYPOTHESIS` и не попадает в активную реализацию.