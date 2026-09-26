# RENOVA — российские professional construction/design systems

**Status:** ACTIVE RESEARCH ANNEX / не самостоятельный roadmap.
**Дата:** 2026-09-09.
**Цель:** сравнить RENOVA не только с consumer marketplace/end-to-end сервисами, но и с российскими профессиональными системами подрядчиков/дизайнеров, чтобы не изобретать заново зрелые паттерны и одновременно не превращать RENOVA в тяжёлую ERP.

---

# 1. Gectaro — российский construction/contractor OS

**Официальные источники:**
- https://gectaro.com/
- https://gectaro.com/kontrol

Публично заявлены/показаны:
- сметы и справочники;
- график работ;
- финансовый и управленческий учёт;
- управление снабжением;
- складской учёт;
- задачи и обсуждения;
- документы/акты/отчёты;
- приложение для прораба с фотоотчётами;
- клиентский доступ с сокрытием внутренней себестоимости;
- контроль подрядчиков;
- согласование чистовых материалов с заказчиком;
- Open API/integrations;
- роли руководитель/прораб/финансист/снабженец/менеджер/клиент.

## Что брать как паттерн

**USE NOW:**
1. Связь schedule/tasks/material supply/finance — данные не должны жить отдельными таблицами без cross-link.
2. Field report/photo должен обновлять управленческую картину через canonical facts.
3. Клиент видит customer-relevant financial/schedule truth, но не внутреннюю коммерческую себестоимость подрядчика без явного права.
4. Contractor team roles требуют собственной внутриорганизационной модели доступа, отличной от независимых `ProjectParticipant` principals.
5. Dashboard должен показывать отклонения и действия, а не просто KPI.

## Где RENOVA должна отличаться

Gectaro естественно ориентирован на строительную компанию/генподрядчика как центр операционной модели. RENOVA target:

- **customer-owned project authority**;
- несколько независимых contractors/principals, не только сотрудники/субподрядчики одной компании;
- единый customer finance/acceptance/material/document graph;
- marketplace/direct invite into same project;
- consumer-grade UX и прозрачные decision rights;
- Russian payment/fiscal/signature ports;
- warranty/handover continuity.

**DO NOT COPY:** полноценный склад/ERP/КС-контур как обязательный customer core. Для крупных подрядчиков он может быть partner/integration layer later.

---

# 2. Сметтер — смета → заказчик → график → задачи → закупки

**Официальный справочный центр:** https://help.smetter.ru/

Подтверждённые публичные patterns:

- commercial estimate editor с себестоимостью/наценкой;
- собственные базы расценок/материалов/шаблонов;
- отдельное customer view согласования сметы, где внутренняя себестоимость и наценки скрыты;
- estimate status lifecycle `draft / approval / in work / completed`;
- график и календарное планирование;
- задачи из графика;
- план платежей;
- закупки после запуска сметы в работу;
- поставки/requests suppliers;
- фактические цены/количества;
- закупка материала несколькими партиями по разной цене.

## Что RENOVA должна адаптировать

### 2.1. Разделить customer price и contractor economics

Customer budget/approved price не равен contractor cost/margin. Если contractor profitability вводится позже:

```text
Customer commercial layer
  != contractor internal cost/margin layer
```

Access policy обязан исключать утечку себестоимости sibling contractor/customer без явного business requirement.

### 2.2. Estimate → schedule linkage

Из утверждённого scope можно формировать planning candidates, но:
- estimate line не автоматически completed work;
- generated Stage/WorkOrder имеет lineage к source scope;
- дальнейшее изменение approved estimate идет через ChangeOrder/revision;
- schedule остается собственной execution truth, а не повтором сметы.

### 2.3. Закупки партиями

Сметтер подтверждает реальную потребность учитывать материал несколькими партиями с разными ценами. Для RENOVA это важный target:

`approved need quantity → Purchase/lot 1 + lot 2 + ... → delivered quantities → actual prices → returns/replacements`.

Одна строка MaterialPick/Purchase status не должна навсегда ограничивать продукт до «куплено/не куплено».

### 2.4. Customer approval view

RENOVA Approvals/cockpit должен показывать customer decision context, а не contractor internal accounting.

**DO NOT COPY:** собственная нормативно-коммерческая база расценок как P0. Это отдельный data/product opportunity только после определения provenance, региона, даты и коммерческой модели.

---

# 3. Planoplan — design/plan/specification/estimate continuity

**Официальные источники:**
- https://planoplan.com/ru/
- https://planoplan.com/ru/help-center/documentation/documentation-and-demonstration/project-estimate/

Публичные сильные patterns:
- 2D/3D планировка;
- реальные catalog objects/materials;
- рендеры/панорамы/virtual tour;
- планы электрики/сантехники/отделки;
- развёртки стен;
- specification;
- PDF documentation;
- estimate автоматически собирает объекты проекта, quantity/price;
- синхронизация project→estimate с защитой вручную изменённых строк;
- read-only sharing и CSV export;
- team account.

## Для RENOVA

**ADAPT NOW AT DATA CONTRACT LEVEL:**

`Room/FloorPlan/DesignPackage → specification/material quantities → Estimate/MaterialNeed` с явной provenance/version.

При изменении плана:
- draft calculation можно пересчитать;
- вручную/approved изменённые коммерческие строки нельзя молча перезаписывать;
- approved baseline требует explicit change path;
- export/share всегда version/as-of aware.

**LATER:** richer 2D/3D editor, rendering, plan annotations, BIM/LiDAR. RENOVA не должна строить полноценный Planoplan до завершения core execution/finance/offline.

---

# 4. Сравнение с RENOVA

| Capability | Gectaro | Сметтер | Planoplan | RENOVA target |
|---|---|---|---|---|
| Contractor company operations | **strong** | **strong** | weak | `LATER/partner`, не customer core |
| Customer project control | medium/strong controlled view | estimate/payment view | design sharing | **strong full lifecycle** |
| Multi-independent principals | contractor/subcontractor organization model | company object model | team design | **customer-controlled first-class scopes** |
| Estimate | strong | **strong** | design-derived | **strong + version/change truth** |
| Internal contractor cost/margin | strong | **strong** | weak | `LATER`, isolated from customer finance |
| Schedule/tasks | strong | strong | weak | **strong** |
| Field photo/progress | strong | mobile field | design-oriented | **evidence-first** |
| Procurement | strong | **strong lots/fact prices** | estimate/spec only | **need→lot/order→delivery→return** |
| Design/plan | basic/project context | measurements/estimate | **very strong** | existing foundations, richer later |
| Acceptance/rework | construction control | less central than estimate | weak | **core differentiator** |
| Consumer payment/fiscal | not central | not central | no | **provider-neutral Russian readiness** |
| Warranty/handover | documents/acts | business docs | design docs | **acceptance-linked lifecycle** |
| Marketplace | no core | no core | no | **integrated discovery/direct invite** |

---

# 5. Product decision

Российский professional software уже хорошо решает отдельные стороны строительного бизнеса. Поэтому RENOVA не должна конкурировать лоб в лоб по принципу «100+ функций для строительной компании».

Наиболее защищаемая позиция:

> **customer-owned operating graph ремонта, в который могут входить несколько независимых подрядчиков и команды, а estimate, schedule, materials, evidence, acceptance, money, documents и warranty остаются связанными и доказательными.**

Professional contractor layer развивается позже как:
- contractor profitability;
- team/capacity;
- templates/reference rates;
- supplier/warehouse/accounting integrations;
- 1C/ERP/Open API;

но не должен разрушать простоту customer core или превращать RENOVA в ERP, которой должен управлять только профессиональный ПТО/финансист.

# 6. Новые требования, добавляемые в product-fit backlog, но не автоматически READY

1. Contractor internal economics must be isolated from customer commercial view.
2. Procurement must support multi-lot/partial quantity economics before deep retailer integration.
3. Estimate→schedule lineage should be explicit without conflating plan and execution.
4. Design/floor-plan recalculation must protect manually approved/frozen commercial decisions.
5. Contractor-team access is separate from independent-principal `ProjectParticipant` access.
6. Future Open API/1C integrations use purpose-bound partner interfaces from `ECOSYSTEM-INTEGRATION-ARCHITECTURE.md`.

Каждый пункт проходит тот же source/reuse/lifecycle/reliability/UX/evidence gate и не меняет текущий P0 order.