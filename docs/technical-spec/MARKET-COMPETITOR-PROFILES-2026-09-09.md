# RENOVA — расширенные профили аналогов и применимость

**Status:** ACTIVE RESEARCH ANNEX.
**Date:** 2026-09-09.
**Parent:** `MARKET-PRODUCT-BENCHMARK-2026-09-09.md`.

Цель — не feature parity. Для каждого аналога фиксируется его сильный product pattern и решение RENOVA: `USE NOW | ADAPT | LATER | DO NOT COPY`.

## 1. Houzz Pro — residential renovation operating system

**Официальный источник:** https://pro.houzz.com/for-pros/houzz-pro-features

Сильные паттерны:
- all-in-one flow вместо разрозненных инструментов;
- 3D floor plans/takeoffs → estimate;
- estimates/proposals/change orders/invoices/payments/budget/job costing;
- selections boards с comments/approvals и связью с procurement;
- client dashboard;
- schedule/tasks/daily logs/subcontractor dashboard;
- procurement/purchase orders;
- e-sign/approvals;
- project profitability;
- AI assistants.

**Для RENOVA:**
- `USE NOW`: связанный project cockpit, selections→procurement, financial lineage, customer/contractor dashboards;
- `ADAPT`: selections через существующий MaterialPick, не второй selections SoT;
- `LATER`: floor-plan annotation/AI takeoff/AI summaries;
- `DO NOT COPY`: AI как authority estimate/payment/approval.

## 2. Buildertrend — client/contractor lifecycle and financial visibility

**Источники:** https://buildertrend.com/builder-software/ ; https://buildertrend.com/project-management/construction-warranty/

Сильные паттерны:
- lead/proposal → change orders → schedule/tasks/daily logs → client/sub portal;
- budget/job costing/invoices/payments/purchase orders;
- controlled client visibility;
- warranty after project handover;
- clear cost layers: original/revised/committed/actual.

**Для RENOVA:**
- `USE NOW`: Original/Revised/Committed/Actual/Cash projection; controlled participant workspace; warranty linked to acceptance;
- `ADAPT`: daily progress as lightweight projection over existing facts;
- `DO NOT COPY`: one-general-contractor worldview as only participant model.

## 3. JobTread — external participant portal and selections

**Источник:** https://www.jobtread.com/

Сильные паттерны:
- CRM/estimating/contracts/e-sign;
- tasks/scheduling/daily logs/files/forms;
- customer/sub/vendor portals;
- selections/allowances;
- change orders/job costing/PO/work orders/invoices;
- customer financing option.

**Для RENOVA:**
- `USE NOW`: external participant UX around explicit scopes; linked work/order/finance documents;
- `ADAPT`: allowances into MaterialPick/Estimate/ChangeOrder, not parallel budget;
- `LATER`: FinancingProvider;
- `DO NOT COPY`: generic CRM duplication of existing marketplace/project relationship graph.

## 4. Contractor Foreman — controlled client portal and compact contractor OS

**Источники:** https://contractorforeman.com/ ; https://contractorforeman.com/features/project-management/client-portal/

Сильные паттерны:
- client portal с controlled view;
- estimate/change-order/RFI/submittal approvals;
- schedule/daily log/photos/action items;
- estimates/invoices/payments/PO/subcontracts/job costing;
- inspections/punchlists/work orders.

**Для RENOVA:**
- `USE NOW`: customer sees only meaningful project attention/results; contractors get focused work view; issues tied to work/location;
- `ADAPT`: RFI/submittal semantics as typed request/approval using current Approval/Document/Chat domains;
- `DO NOT COPY`: duplicate RFI database solely for terminology parity.

## 5. Buildxact — estimate/takeoff/supplier integration for residential builders

**Официальный source:** https://help.buildxact.com/ (2026 plan/feature descriptions).

Patterns:
- lead management;
- digital takeoffs and estimating;
- supplier/dealer integration;
- purchase orders;
- job management + Gantt;
- change orders;
- client portal/selections;
- native timesheets;
- AI estimate/takeoff assistants.

**Для RENOVA:**
- `USE NOW`: supplier-neutral procurement boundary and change impact;
- `LATER`: timesheet/project profitability for contractor; AI-assisted scope/takeoff after source truth;
- `DO NOT COPY`: supplier-specific product ids inside RENOVA material master.

## 6. Procore — construction “golden thread”

**Источник:** https://www.procore.com/commercial

Сильные паттерны:
- financial management/change control;
- document control/version history;
- quality/defect workflows;
- strict permissions;
- field data tied to project financials;
- audit trail from tender/change through handover.

**Для RENOVA:**
- `USE NOW`: immutable document lineage, issue→room/stage/photo links, explicit scope permissions, project closeout evidence;
- `ADAPT`: Procore-grade “golden thread” to consumer renovation without enterprise bureaucracy;
- `DO NOT COPY`: broad safety/RFI/submittal enterprise modules unless a RENOVA user problem proves need.

## 7. Fieldwire — field-first/offline execution

**Источник:** https://www.fieldwire.com/

Patterns:
- tasks/punch lists/inspections;
- plans + markups + photos/video;
- mobile/offline jobsite work;
- forms/daily reports;
- version-aware plans.

**Для RENOVA:**
- `USE NOW`: offline correctness as product requirement (#315–#317), minimal-tap stage/work/photo workflow;
- `ADAPT`: acceptance issue as punch item linked to location/evidence;
- `LATER`: plan markup/as-built;
- `DO NOT COPY`: separate forms engine before current documents/approvals are complete.

## 8. ServiceTitan Construction — contractor economics and milestone billing

**Источник:** https://www.servicetitan.com/features/construction-project-management-software

Patterns:
- estimates vs actuals;
- labor productivity/project financial view;
- schedule of values;
- progress/milestone billing;
- backlog/profit view.

**Для RENOVA:**
- `ADAPT LATER`: contractor business cockpit and milestone-linked billing after payment/expense truth is fully stable;
- `DO NOT COPY NOW`: enterprise accounting/retention mechanics into customer core without validated demand.

## 9. Профи.ру — российский marketplace trust/discovery

**Источники:** https://profi.ru/about/ ; https://profi.ru/

Patterns:
- customer describes task/budget/time/place;
- multiple professionals send offers;
- choice by price/rating/reviews/examples;
- verified profile attributes;
- two-sided reviews tied to real interaction;
- direct payment or safe-deal mode where available;
- support/dispute assistance.

**Для RENOVA:**
- `USE NOW`: structured lead/quote comparison and marketplace→participant conversion;
- `ADAPT`: verified contractor attributes backed by exact evidence/status; completed-project reputation;
- `DIFFERENTIATE`: Pрофи primarily matches people; RENOVA must continue through scope/schedule/materials/acceptance/money/docs/warranty.

## 10. Thumbtack / Angi — fast discovery, price confidence and trust

**Источники:** https://www.thumbtack.com/how-it-works ; https://www.angi.com/landing/how-it-works

Patterns:
- search by home need;
- verified reviews;
- transparent/benchmark price cues;
- instant book for simple services, quote comparison for larger work;
- screened/approved professionals.

**Для RENOVA:**
- `ADAPT`: reduce marketplace friction and improve scope/questionnaire quality; show price context only when provenance/sample/region/date are explicit;
- `LATER`: instant-book only for truly standardized small jobs;
- `DO NOT COPY`: national-average price shown as authoritative local renovation estimate.

## 11. Петрович / ПроПетрович / B2B — retail + object fulfillment ecosystem

**Источники:** https://b2b.petrovich.ru/ ; https://pro.petrovich.ru/ ; https://petrovich.ru/

Public patterns:
- catalog/estimate/calculator;
- professional marketplace;
- object supply;
- delivery windows and lifting services;
- electronic delivery confirmation;
- individualized pricing/crediting in B2B;
- long return window;
- supplier/manufacturer network.

**Для RENOVA:**
- `STRATEGIC`: become project demand/orchestration layer: approved material need + quantity + required date + project location → provider-neutral offers/order/delivery/return;
- `USE NOW`: distinguish purchase, delivery, partial delivery, return/replacement and receipt truth internally;
- `LATER`: retailer adapters;
- `DO NOT COPY`: retailer catalog as RENOVA authoritative product master.

## 12. YooKassa — future payment infrastructure, not product SoT

**Sources:** https://yookassa.ru/developers/api ; https://yookassa.ru/developers/using-api/interaction-format ; https://yookassa.ru/developers/using-api/webhooks

Important integration properties:
- idempotency keys for mutating requests;
- async status/webhook lifecycle;
- payments/refunds/capture/safe-deal variants;
- webhook authenticity/status validation and redelivery.

**RENOVA requirement now:** PaymentProvider + durable provider operation + reconciliation. No real credentials or transaction yet.

## 13. ФНС / НПД — future fiscal truth

**Source:** official `nalog.gov.ru` materials on professional-income-tax receipts.

Pattern relevant to product architecture: self-employed taxpayer must form and transfer receipt; offline situations exist and subsequent synchronization matters.

**RENOVA requirement now:** fiscal receipt and NPD status are provider facts, separate from Payment/Expense. Simulator must cover valid/not-found/mismatch/timeout/offline/retry states. No claim of FNS verification until real integration is externally qualified.

## 14. Контур Диадок / future Госключ — document infrastructure

**Source:** https://developer.kontur.ru/doc/diadoc-api/index.html

Pattern: API integration, authorization, document-flow lifecycle, SDK/OpenAPI, deprecation management.

**RENOVA requirement now:** internal Document/version/signer lifecycle independent from provider; ESignProvider maps external state. Goskey remains not implemented until actual adapter project.

---

# 15. Competitive position matrix

| Dimension | Marketplace (Профи/Thumbtack/Angi) | Contractor OS (Houzz/Buildertrend/JobTread/CF/Buildxact) | Construction platform (Procore/Fieldwire) | RENOVA target |
|---|---|---|---|---|
| Find contractor | strong | medium | weak | strong |
| Multi-independent contractor project | usually weak after match | often org/sub-oriented | enterprise subcontracting | **first-class customer-controlled scopes** |
| Customer transparency | medium | strong | medium | **strong, consumer-first** |
| Estimate/change control | weak-medium | strong | strong | **strong** |
| Material procurement | weak | strong | medium | **strong + Russian retail-ready** |
| Acceptance/rework | weak | medium | strong quality tools | **strong consumer legal/evidence chain** |
| Payment/fiscal | marketplace-dependent | payment integrations | financial integrations | **separate Payment/Expense/Receipt + Russian ports** |
| Docs/signature | weak | medium-strong | strong | **versioned + provider-neutral** |
| Warranty | weak | strong in some | closeout/quality | **linked to acceptance** |
| Offline field | weak | medium | strong | **must become strong** |
| Russian fiscal/signature fit | local marketplace only partially | no | no | **architectural differentiator** |
| Retail/bank partner graph | limited | financing/procurement in some | enterprise integrations | **future consented ecosystem layer** |

# 16. Final product decision

RENOVA should optimize for **trust and continuity**, not raw feature count:

1. marketplace brings the participant into a real project;
2. project defines scope and authority;
3. estimate/change orders define expected economics;
4. schedule/work/evidence define execution;
5. materials define demand/procurement/fulfillment;
6. acceptance defines completed quality;
7. payment/receipt/refund define economic/fiscal facts;
8. documents preserve legal/project lineage;
9. warranty continues responsibility after handover;
10. provider/partner adapters extend this graph without owning it.

Если новая функция не усиливает эту цепочку и не имеет доказанного terminal user result, она не получает приоритет перед закрытием core lifecycle.
