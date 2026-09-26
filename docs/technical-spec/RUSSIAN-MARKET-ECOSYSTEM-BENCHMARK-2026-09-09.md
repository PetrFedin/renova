# RENOVA — российский рынок ремонта и ecosystem benchmark

**Status:** ACTIVE RESEARCH ANNEX / не самостоятельный roadmap.
**Дата:** 2026-09-09.
**Связанные документы:** `MARKET-PRODUCT-BENCHMARK-2026-09-09.md`, `MARKET-COMPETITOR-PROFILES-2026-09-09.md`, `PRODUCT-COMPLETION-MANDATE.md`.

Этот документ отдельно рассматривает российские customer/contractor/retail/bank/infrastructure patterns. Реальное подключение внешних сервисов не выполняется.

---

## 1. Домклик «Ремонт» — наиболее близкий российский end-to-end benchmark

**Официальный источник:** https://domclick.ru/my-home/promo/remont

На странице сервиса публично описаны:
- проверенные подрядчики;
- индивидуальный подбор исполнителя;
- смета и договор после выезда специалиста;
- план ремонта в личном кабинете;
- поэтапное выполнение;
- заказчик принимает или возвращает этап на доработку;
- поэтапная безопасная оплата;
- резервирование суммы до выполнения/приёмки этапа;
- изменение сметы по взаимному согласию через дополнительное соглашение;
- дизайн-проект и материалы как возможные составляющие;
- базовый/расширенный технадзор/строительный контроль.

### Что это подтверждает для RENOVA

**ADOPT NOW AS PRODUCT PRINCIPLE:**
1. Stage и payment должны быть связаны, но не слиты: готовность этапа → review → accept/rework → разрешённый payment transition.
2. Изменение стоимости/объёма после согласования требует явного ChangeOrder/документного следа.
3. Технадзор ценен как отдельная роль/доказательство, а не как customer self-acceptance.
4. Customer cockpit должен показывать план, факт, приёмку и следующий финансовый action в одном контексте.

**RENOVA DIFFERENTIATION:**
- несколько независимых исполнителей в одном проекте со своими scopes;
- материалы/selection/procurement как first-class lifecycle;
- offline/retry correctness;
- документ/подпись/fiscal/provider architecture;
- единый evidence graph до warranty/archive;
- возможность future retailer/bank integrations через нейтральные ports.

**DO NOT IMPLEMENT YET:**
- реальное резервирование/эскроу/«безопасная сделка» до отдельного legal/payment-provider проекта;
- bank-specific payment mechanics inside core.

---

## 2. YouDo — российский marketplace + safe-deal pattern

**Официальные источники:** https://youdo.com/ ; https://youdo.com/verification

Публичный flow:
`заказчик описывает задачу → получает отклики с ценами → выбирает по отзывам/цене/примерам → обсуждает сроки → выполнение → оплата/отзыв`.

YouDo также публично описывает:
- подтверждение документов/контактов исполнителей;
- отзывы;
- «Сделку без риска» для поддерживаемых сценариев;
- возможность прямой оплаты вне safe-deal сценария;
- contractor-side модель поиска заказов/откликов.

### Для RENOVA

**USE NOW:** structured lead/quote/comparison; evidence-backed contractor attributes; two-sided reputation after actual completed project.

**DIFFERENTIATE:** marketplace не заканчивается выбором специалиста: selected participant продолжает в том же object/scope/schedule/material/acceptance/payment/document/warranty graph.

**LATER:** safe-deal/payment-hold mechanics only through regulated/provider boundary.

---

## 3. Профи.ру — discovery/reputation benchmark

**Официальные источники:** https://profi.ru/about/ ; https://profi.ru/

Полезные patterns:
- понятное формирование задания;
- заинтересованные специалисты предлагают условия;
- выбор по цене/рейтингу/отзывам/работам;
- подтверждённые profile attributes;
- reputation связан с реальным interaction.

### Для RENOVA

- улучшать questionnaire/lead quality, чтобы quote был сопоставим;
- verified badge только от конкретного evidence/provider, никогда не декоративный;
- reputation строить из завершённых/принятых проектов и dispute/warranty context, не только свободного текста;
- contractor history должна учитывать role/scope — один специалист не получает credit за sibling work.

---

## 4. Лемана ПРО — retail + design + installation ecosystem

**Официальные источники:** страницы `lemanapro.ru/uslugi/` и проектирования/дизайна.

Публичные patterns:
- дизайн-проект;
- замер;
- подбор материалов;
- смета;
- комплексный ремонт/монтаж;
- проверенные партнёры;
- гарантия;
- товар и услуга в одном customer journey;
- для отдельных категорий — online project with manager, delivery/assembly/installation.

### Для RENOVA

**STRATEGIC:** retailer integration должна начинаться не с витрины, а с project demand:
`room/stage need → approved selection → quantity → required date/location → retailer offer → order → delivery → return/replacement → receipt/warranty`.

Retailer получает качественный project-linked demand; RENOVA сохраняет product/material need и Purchase как internal authority. Retail catalog ID — external reference, не Renova master truth.

---

## 5. Петрович / B2B / ПроПетрович — supply and professional ecosystem

**Официальные источники:** https://b2b.petrovich.ru/ ; https://pro.petrovich.ru/ ; https://petrovich.ru/

Relevant public patterns:
- комплектация объектов;
- delivery logistics;
- electronic delivery confirmation;
- возвраты;
- индивидуальные коммерческие условия для B2B;
- professional/customer matching ecosystem.

### Для RENOVA

Это подтверждает ценность будущих provider-neutral `Catalog/Offer/Order/Fulfillment/Return` interfaces. Перед этим RENOVA обязана internally разделить:
- requested vs ordered qty;
- paid vs delivered;
- partial delivery;
- damaged/rejected/returned qty;
- replacement;
- receipt/expense/refund.

---

## 6. Банки: кредит на ремонт как отдельный зрелый спрос

**Текущие официальные примеры:**
- ВТБ: https://www.vtb.ru/personal/kredit/na-remont/
- Т-Банк: https://www.tbank.ru/loans/cash-loan/na-remont/
- Альфа-Банк: https://alfabank.ru/get-money/credit/na-remont-kvartiry/

Наличие отдельных продуктов «кредит на ремонт» подтверждает самостоятельный financing use case, но не даёт RENOVA права становиться кредитным скорингом.

### Future FinancingProvider model

RENOVA с явным consent может подготовить partner snapshot:
- requested financing amount;
- approved/revised project budget;
- project stages/milestones;
- contractor/contract status where lawful;
- accepted progress;
- recognized actuals/payments where user authorizes;
- change-order history.

Bank/provider returns:
`eligibility/offer → application_url or embedded provider session → status → accepted/rejected/expired`.

Rules:
- кредитное решение и KYC остаются у банка;
- минимизация данных + consent + audit;
- no raw private project export by default;
- no bank-specific fields in core project entities;
- financing failure never changes accepted work/payment truth.

---

## 7. ФНС/НПД — fiscal readiness как российский differentiator

**Официальный источник:** https://www.nalog.gov.ru/

Для самозанятого чек НПД — отдельная fiscal обязанность/сущность. Следовательно:
- Payment не равен Receipt;
- Receipt не равен Expense;
- fiscal verification/status приходит через отдельный port;
- offline/late synchronization и corrections должны иметь явный lifecycle;
- UI не говорит «проверено ФНС», пока нет authoritative external result.

Текущий simulated `FiscalReceiptProvider/NpdStatusProvider` должен проверять contract, а не имитировать real verification claim.

---

## 8. Контур / future Госключ — document/signature infrastructure

**Контур Диадок API:** https://developer.kontur.ru/doc/diadoc-api/index.html

Russian product needs provider-independent internal document truth:
`Document → exact immutable Version → SignerIntent → provider operation → external status → verification/reconciliation → signature fact`.

Контур/Goskey later become adapters. Provider timeout does not make document signed. Changed signed content creates new version.

---

## 9. Russian competitive matrix

| Capability | Домклик Ремонт | YouDo/Профи | Лемана/Петрович | RENOVA target |
|---|---|---|---|---|
| Поиск исполнителя | curated | strong marketplace | partner/service network | strong marketplace + external invite |
| Несколько независимых contractors | не публичный основной акцент | separate tasks | service/provider dependent | **first-class scoped project** |
| Смета/change control | strong stage/contract model | weak after match | estimate within service/retail journey | **versioned estimate + ChangeOrder** |
| График | personal cabinet stage plan | limited after match | service-specific | **canonical schedule/dependencies** |
| Приёмка/rework | strong | completion/review | service guarantee | **evidence-linked immutable lineage** |
| Технадзор | explicit offering | weak | provider/service dependent | **separate scoped role** |
| Безопасная оплата | stage-reserve model | supported safe-deal modes | commerce/payment ecosystem | **provider-ready later; domain ready now** |
| Материалы | may be included | weak | **strong** | **project demand + retailer-neutral fulfillment** |
| Fiscal/NPD | not core user proposition | marketplace-specific | not project core | **separate Russian fiscal port** |
| Docs/signature | contract workflow | task terms | retail/service docs | **versioned provider-neutral docs** |
| Offline field | not public differentiator | generic mobile | commerce apps | **must be core strength** |
| Warranty | contractor/service terms | reviews/support | explicit guarantees | **acceptance-linked warranty graph** |

---

## 10. Value proposition by ecosystem participant

### Customer
One source of truth and defensible control: who does what, what was approved, when due, what delivered, what accepted, what paid, what changed, what remains under warranty.

### Contractor
Lead-to-cash operating flow with less manual admin, clear scope, evidence, customer decisions, material coordination and eventual reputation/profitability.

### Retailer
Qualified project demand with quantity/date/location and approval context; lower ambiguity than generic e-commerce browsing; future conversion/order/delivery/return integration.

### Bank
Consented structured project facts and milestones around an already existing renovation-financing demand; provider owns underwriting.

### State/infrastructure
Potentially cleaner formalization of participants, documents and fiscal events. No automatic government data sharing; every external data flow requires lawful basis/consent/minimization.

### Investor
A multi-sided transaction graph rather than a single marketplace: discovery → project → execution → commerce → acceptance → finance → documents → warranty. Network/data value exists only if lifecycle truth and user retention are real; it is not justified by feature count.

---

## 11. Russian product priorities derived from benchmark

**P0/core:**
- session/offline/idempotency integrity;
- multi-contractor scopes;
- stage/rework/acceptance evidence;
- Original/Revised/Committed/Actual/Paid finance truth;
- material selection/procurement/delivery/return;
- docs/version/signature boundary;
- warranty;
- operator recovery.

**T1 after core:**
- verified reputation from completed project evidence;
- retailer ports;
- contractor profitability;
- lightweight daily progress;
- richer design/selection links.

**T2 after internal proof/legal readiness:**
- bank financing offers;
- safe-deal/reserved-funds products;
- live FNS/NPD/Kontur/Goskey;
- partner APIs;
- AI assistants with human confirmation.

Russian market research therefore strengthens, rather than changes, the central architecture: **RENOVA should own the renovation truth graph and let regulated/commercial partners own their external decisions and transactions through narrow, reconcilable ports.**