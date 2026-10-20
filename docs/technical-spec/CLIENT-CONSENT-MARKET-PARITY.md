# RENOVA · Client Consent & Market-Parity Architecture
**Version:** 2026-10-20 · **Status:** DESIGN + BOUNDED DRAFT IMPLEMENTATION, NOT PRODUCTION.
**Owner:** RENOVA product/finance/security; [P0 #757](https://github.com/PetrFedin/renova/issues/757).
**Governance:** AGENTS.md, PRODUCT-COMPLETION-MANDATE.md, GOLDEN-PATHS.md, END-TO-END-GOVERNANCE.md.
**Legal:** this is a product contract, not a substitute for legal review of each contract type and jurisdiction.

## 1. Non-negotiable promise

RENOVA must distinguish **proposed** cost from **customer-authorized** cost, **actual money movement** from **approved obligation**, and **performed work** from **customer-accepted work**. Never infer consent from a contractor, silence, viewing a notification, a read receipt, auto-ticked boxes, a payment webhook, a chat message, an imported bank row or an accounting reconciliation.

No RENOVA-originated new customer-payable commitment is admitted without:
- the authenticated **customer identity and project membership**;
- immutable identity of the scope **version and approved payload**;
- **kind of work/material/service**, room, stage and measured quantity/unit;
- responsible **named specialist/subcontractor**, deliverables, substitution policy;
- scope inclusions, explicit exclusions, dependencies, risk and completion evidence;
- **price and maximum exposure**, RUB currency, VAT/tax treatment (where applicable), who pays;
- agreed start/end dates and impacts on adjacent stages; planned payment milestone;
- specific customer approval action with digest, timestamp, source-auth context;
- current unrevoked consent with available limit, enforced by the authoritative PostgreSQL transaction and no retroactive rewriting.

Existing contractual due payments and lawful emergency measures require *separate* categorization; do not invent new consent requirements that nullify prior binding agreements. External provider/bank money movements must **always be recorded as evidence**, even when approval is absent, then flagged `unmatched_external_movement` and escalated; never pretend a charge didn't happen.

### One financial operation, one trail

`Contract → Approved estimate/version → Authorized work package → Named specialist & schedule → Amount cap → (PO | invoice | advance milestone) → Provider/bank settlement → Receipt/waybill → Recognized Expense → Work evidence → Independent acceptance/warranty → Reconciliation`.

Every hop requires a project-bound ID, correct actor/role, financial exactness, immutable evidence and a customer-facing explanation. Any missing connection is a visible **blocker**, not an optimistic success.

## 2. Russian-market evidence and adoption targets

These are the providers' published feature descriptions, **not a paid-console functional or security penetration audit**. Avoid claims that an unlisted feature is absent.

| Provider | Published functions worth including | RENOVA added client-centric requirement | Evidence |
| --- | --- | --- | --- |
| Gectaro | estimates, schedules, finance, procurement, stock, progress, documents, mobile foreman, API | customer-side authorization ledger joins each cost to accepted scope, specialist, timing and cap | https://gectaro.com/ ; https://gectaro.com/finychet |
| Сметтер | estimates/proposals, customer comments & approval, payments, reconciliation, procurement, receipt OCR, subcontractors, acts, photo progress, reports | immutable approved estimate versions + mandatory change approval with before/after financial and timeline deltas | https://help.smetter.ru/estimate_approval ; https://smetter.ru/functions ; https://help.smetter.ru/customer_updates |
| СМЕТРУМ | estimate versioning, procurement and supply, stage facts, warehouse, finance, approval routes, documents, timesheets, analytics | one consistent customer decision across estimate→PO→payment→proof→acceptance, not separate unlinked "green" modules | https://smetrum.ru/modules/estimates ; https://smetrum.ru/modules/approvals ; https://smetrum.ru/modules/supply |
| RemPlanner | floor plan, electromechanical drawings, wall elevations, 3D, quantities and estimates | measurement/provenance link from room drawing version to each approved quantity; deterministic remeasurement diff | https://remplanner.ru/ |
| PlanRadar | drawing-anchored defect tickets, photo/video, responsibilities, reports, site diary, inspection & acceptance | time-stamped work evidence, independent inspector path and automatically enforced payment hold on open defects | https://www.planradar.com/ru/harakteristiki/upravlenie-stroitelstvom/ |

**Do not copy brand identity or assert exact parity without exercising real user paths.** Next market verification: customer/contractor role walkthroughs against their latest documented demos, review permissions and pricing tiers without buying subscriptions.

## 3. Feature-completeness checklist

**A. Before works:** contract typology, licensed/specialist qualification where relevant, parties/roles, site inspection, project design, measurements, scope taxonomy, exclusions and alternatives, fixed/approximate price classification, documented contingencies, payment schedule, warranties, signed project/contract versions, distinct emergency/unsafe-condition process.

**B. Scope execution:** rooms/floors/zones, stage dependencies, WorkOrder items, quantity/unit-rate, assigned real specialist, employment/subcontractor authorization, planned hours/dates, prerequisite materials, HSE permits/checklist where relevant, photos before/after, quality measurements, blocked/paused status, material substitution request, handover and customer decision.

**C. Money & materials:** client-authorized capped budget, committed vs actual vs paid vs refunded vs disputed vs withheld; purchase requests, supplier quotes, order-to-receipt-to-invoice triple match, delivery and defects, SKU/quantity/price substitutions, receipts/FNS evidence vs paid money, independent reconciliation, bank import and customer visibility, receipt OCR confidence, duplicate-source protection, returns and remaining materials, supplier/contractor invoices and audit.

**D. Consent & protections:** per-line approval, informed financial ceiling, no auto-consent, value/scope/schedule/specialist diff, consent revocation within lawful conditions, electronic signature evidence, reminders and read tracking **not equal** consent, revision digest, operator/legal exception audit, anti-IDOR, transaction locks, idempotency for retries, mandatory audit and outbox, portable evidence export, escalation and mediation.

**E. Quality & post-work:** independent technical supervision, photo/video and drawing annotations, defect lists, 2-party handovers, repair loops, withheld amount, penalty/credit policy under contract, warranty timeline, claims, closeout accounting, material traceability and document archive.

**F. UX:** customer: approvals inbox, plan vs authorized vs committed vs spent vs paid, work/specialist table and exact "why this bill?" drilldown, alerts before financial change, dispute button; contractor: truthful offer/proposal wizard, disclosed exclusions, staff assignment and dates, comparison of alternatives, documented request-for-change; supplier: RFQ/PO/delivery; independent technical supervisor: scope read/inspection only and separated powers; owner/operator: safe reconciliation with visible audit; phone/desktop, offline conflict, accessibility, localized Russian legal copy.

**G. Enterprise growth (not MVP release blockers):** multi-project control, contractor reputation with verifiable evidence, optional BIM/IFC and IFC→quantities import, warehouse, cost forecast and earned value, scheduling optimization, portfolio finance, insurance/bank evidence export, market-price provenance, anomaly alerts, AI assistance with *human* approvals, API/webhooks, compliant data portability.

### Non-duplication rule
Add no competing Payment/Expense/Receipt ledger for a new UI; build one versioned consent source and link existing canonical business events by typed foreign keys.

## 4. Source-audit findings, code paths to qualify

| Existing code | Confirmed source behavior | Incomplete protection / action |
| --- | --- | --- |
| `backend/app/api/v1/estimate.py` | contractor proposes lock; customer alone locks after stale proposal checks | lock proves baseline estimate but not a per-specialist/payable limit for every downstream transaction |
| `backend/app/services/_work_order_service_core.py` | customer approves `published→approved` and later accepts; existing patch previously allowed post-approval scope changes | **P0 first slice:** reject post-approval budget/date/scope/assignee edits; record pending proposal changes with outbox audit/notice |
| `backend/app/api/v1/change_orders.py` | contractor requests paid extras, customer approves/rejects | need itemized scope/quantity/performer/period/delta/snapshot, separately approved financial caps and signed amendment semantics |
| `backend/app/services/purchase_create_service.py` | purchase from approved MaterialPicks and verified prices | need guaranteed linkage of quoted/supplier/bought price to unexpired client authorization, plus partials and substitution diff |
| `backend/app/api/v1/payments.py` | contractor can create stage/material pending requests, customer can create advance/final; project ACL, stage constraints, amount idempotency | missing universal authorization_id and bounded `remaining_commitment` admission at creation and checkout |
| `backend/app/services/expense_integrity_service.py` | source-linked Expense immutability, direct patch/delete with project write ACL | manual expense edits are not universally coupled to per-customer consent; add proposal/hold vs recognized ledger |
| `backend/app/services/payment_reversal_service.py` and `project_refund_ledger.py` | cumulative immutable provider refunds and net spend with project-budget fence candidate #756 | still need authorized-cap reconciliation and two-payment/refund/dispute concurrency qualification |
| `backend/app/services/budget_service.py` | actuals projected from Expense facts and estimate-linked lines | add authorized/committed/unapproved dimensions without mutating existing gross/net meaning |

This table is **source tracing only**, not a declaration of externally executed E2E behavior or 100% project inventory.

## 5. Canonical domain proposal: consent should be first-class

Schema migration **to be designed and qualified in a separate PR**:

- `work_scope_versions(id, project_id, work_order_id, version, payload_json, sha256, created_by, created_at, replaces_id)` — immutable snapshots; fixed quantity/measurement origin/unit/scope exclusions/timing/assignee and payout rule.
- `client_consents(id, scope_version_id, project_id, customer_id, approved_digest, method, assurance, approved_at, revoked_at, superseded_by, evidence_blob_ref)` — append-only events; no manual status patch on approved record.
- `financial_authorizations(id, consent_id, project_id, beneficiary_id, category, currency, amount_cap NUMERIC(14,2), committed NUMERIC(14,2), consumed NUMERIC(14,2), released NUMERIC(14,2), status, version)`. Check exact money, enforce `0 <= consumed <= committed <= amount_cap` plus reserved/released semantics as independently reconciled dimensions.
- `authorization_allocations(id, project_id, financial_authorization_id, operation_kind, operation_id, allocated_amount, source_hash)` — immutable disjoint economic allocations for Payment/Purchase/Expense; avoid treating receipt proof as second cash movement.
- `consent_decision_events(id, previous_hash, payload_hash, actor_id, role, decision, scope_version_id, created_at, request_id, delivery_id)` — chain of tamper-evident records; **hash chain is not a legal signature by itself**, needs separate signature/identity evidence.
- `external_unmatched_movements` — only for actual provider/bank money already moved but lacking a recognized authorization. Visible to both sides, holds liability status for reconciliation; never delete.

All IDs must be actual database FKs or explicit validated system references, not prose/comments or unverified user-provided names. Use one canonical writer in backend; no mobile-only enforcement. Raw passwords/tokens or unnecessary personal data never enter consent snapshots. Authentication assurance, export and deletion must satisfy law and privacy policy.

### Transaction boundaries

1. **Proposal:** contractor builds validated scope version with required structured fields, customer sees old/new before any paid commitment.
2. **Consent:** authenticated customer signs/approves the *specific immutable digest*; atomic state/event/outbox; a changed digest invalidates old approval.
3. **Authorization reservation:** a new payable commitment references one valid consent, correct project/role, amount cap and unconsumed allowance. Lock shared Project then scoped authorization in defined global lock order; conditional spend update + uniqueness and idempotency key. No double reservation on retry.
4. **Settlement:** provider events represent actual cash; do not infer customer authority from provider success. If unauthorized, retain external fact and open blocking reconciliation; if authorized, link settled Payment and Expense net once.
5. **Closeout:** acceptance holds/updates authorized earned value; releases only lawful/contractual funds. Refund/return/credit must reverse economic allocations without rewriting gross invoice or consent.

**Exceptions:** safety-critical prevention of imminent physical harm may require prompt action. Record safety evidence, qualified actor, proportional amount, time and statutory/contract basis. Exception must not masquerade as ordinary customer consent or default license to charge. Counsel and product owner must approve exact policy.

### Negative test baseline
- contractor, subcontractor, admin/operator and cross-project user attempt to approve on customer's behalf → denied;
- modified scope/digest and stale mobile approval → 409; no silent last-writer-wins;
- post-approval price, deadline, assignee, quantity or exclusions PATCH → 409 and no changed DB fields;
- approved 10 000 ₽ cap, two simultaneous charges of 8 000 ₽ → at most one admitted (unless cap increased with explicit new consent);
- duplicate provider payment/receipt, webhook timeout and replay → one economic operation, stable ID/outbox;
- unapproved external 1 000 ₽ movement → retained as `unmatched_external_movement`, *not* displayed as approved charge;
- signed 2 000 ₽ extras without line/schedule/specialist/amount digest → denied;
- refund/dispute/acceptance race → Project budget = exact active net Expense projection, no lost committed money;
- approval popup dismissal, expired login and silence → no approval;
- rejected quality claim should not auto-approve payment or close defect.

## 6. Minimum customer-facing screens and copy

**"До начала"** — scope packages with explicit included/excluded list, assigned named person, deadlines, payments and alternate quote; large action "Согласовать версию N" showing `total budget + change + risk + upcoming liability`. Approval checkbox initially unchecked, with separate contract consent. Preview remains visible after approval.

**"Мои деньги"** — four independent numbers: `approved contractual limit`, `commitments awaiting settlement`, `actually paid (gross/net)`, `earned / accepted work`. Drilldown each line: `why? / document / supplier-specialist / schedule / who approved / when / what changed`. `Missing consent` clearly flagged and cannot be made "OK" by contractor.

**"Изменения"** — compare two immutable versions (price/unit/quantity/room/people/schedule/works/materials), old/new values and exact delta; buttons "Согласовать", "Отклонить", "Попросить уточнение"; outstanding request never auto-accepted. Notification delivery is evidence of sending, not agreement.

**"Спор и качество"** — open/reject/inspect/rework, fixed point/photo, linked financial hold and warranty. Neutral text and user-friendly roles.

## 7. Delivery order & honest readiness

| Priority | Bounded delivery | Evidence |
| --- | --- | --- |
| P0.0 | Repair #756 cross-payment PostgreSQL fixture/CI; do not merge until exact head GREEN | Postgres + backend + Golden + policy + independent review |
| P0.1 | #757 approved WorkOrder immutability and pre-approval change audit/notice; mobile blocked-state clarity | Existing unit tests preserved, new negative tests, mobile source contract, same SHA CI |
| P0.2 | Immutable scope/consent/financial authorization schema and customer decision endpoint | Alembic one head, schema drift, anti-IDOR, exact digest and concurrency |
| P0.3 | Universal money/contract guard across all canonical writers incl webhook/bank external-movement holding path | provider, Postgres races, refund/reconcile, payment/expense/PO E2E |
| P0.4 | Customer visual approvals and assigned specialist wizard; digital audit receipts and version diff | Two-role real browser actions, screenshot/video on exact build |
| P1 | Quality evidence/technical supervisor, payments held for defects, procurement cost variance, closeout proofs | GP4/GP5, role/negative/readback acceptance |
| P2 | 3D/BIM linkage, advanced forecasts, anomaly/AI, supplier ecosystem and integrations | Business-validated hypotheses and pricing pilot |

## 8. Russia legal/compliance mapping (scope-aware)

- Civil Code, art. 709 (price and contractually approved estimate): https://www.consultant.ru/document/cons_doc_LAW_9027/7ac1b059cae570f48b3afe418c6ad41b54f166b1/
- Civil Code, art. 743 (construction technical documentation / unplanned works, notice and exceptions): https://www.consultant.ru/document/cons_doc_LAW_9027/b48c040fb20b324efb339e89ad832027d4b5d97a/
- Consumer Protection Law, art. 16 (unilateral change restrictions and paid extras requiring consumer consent): https://www.consultant.ru/document/cons_doc_LAW_305/9eb0f127ead4dc57e7d0a9d4954cf264c4b3cea8/

Special contract exceptions, consumer vs B2B status, signature evidentiary value, personal-data residency, receipt/FNS/54-FZ, construction licensing, warranty and dispute procedure **require separate legal and integration verification** before a claim of statutory compliance. Product controls are not legal advice.

## 9. Release policy

Never say "each cost is authorized" until transactional guards bind all canonical writes, existing data are classified, and real-role actions with multi-payment PostgreSQL concurrency evidence qualify at one SHA. Tests, image artifacts, marketing demo and production must have separate identity labels. Full CI GREEN alone does **not** prove client-side fairness, live provider reconciliation or a legally sufficient electronic signature.

## 10. Russian-market extension: capabilities to adapt (published October 2026)

The following are **published vendor workflows** and not independently tested console behavior or claims of competitor limitations.

| System and source | Functional capability | RENOVA backlog action, avoiding blind feature copying |
| --- | --- | --- |
| [Сметтер: согласование сметы](https://help.smetter.ru/estimate_approval) | Send a customer-specific estimate link or invite to an account; comments, estimate state, project payment plan and accessible bills. Internal contractor cost/margins can stay private. | Preserve transparency of **full amount owed by customer**, exclusions and tax, without disclosing confidential contractor unit costs not contractually required. Bind visible proposal **revision** to the signed decision and payment cap. |
| [Сметтер: закупки](https://help.smetter.ru/purchases) | Procurement after activating a customer-approved estimate, including partial batches with different actual prices and amounts. | Batch/supplier line allocation of the approved limit; if a replacement or unit-price delta exceeds authority, require **new customer decision before order**; track backorders/returns and invoice vs GRN. |
| [СМЕТРУМ: согласования](https://smetrum.ru/modules/approvals) | Approval routes by document kind/amount for estimates, orders, payments, acceptance documents and files, with reasons and audit history. | Multi-signature **internal** route may strengthen customer authorization but can never **replace** it; original scope/digest/amount/actor remain attached to downstream payment. Escalation, SLA and reason history. |
| [СМЕТРУМ: снабжение](https://smetrum.ru/modules/supply) | Procurement requests tied to work and budget, planned/actual unit costs, deviations before orders, receiving and payment chain. | Material quantity, exact work/room/assignee and delivery window tied to source estimate version; **3-way match** purchase order → delivery → invoice, returns and duplicate receipts. |
| [Gectaro: обучение](https://gectaro.com/guide/) | Budget-exceeding procurement requests and company-level supply summaries; resource substitutions, batches and invoice routing. | Project/portfolio spend **authorization gap** dashboard with precise hold reasons, source links and proof without changing canonical actuals. |
| [Planfix: task dependencies](https://planfix.ru/help/%D0%A1%D0%B2%D1%8F%D0%B7%D0%B8_%D0%BC%D0%B5%D0%B6%D0%B4%D1%83_%D0%B7%D0%B0%D0%B4%D0%B0%D1%87%D0%B0%D0%BC%D0%B8) | Four dependency types and propagated dates on Gantt. General-purpose task tool, not a direct renovation accounting comparison. | Simulate schedule effects across dependencies, but **never silently alter approved customer dates**; generate a before/after amendment requiring new consent if milestones change. |
| [MacroCRM](https://macrocrm.ru/) | Developer-side sales CRM, dashboards, document recognition and client/agent accounts. Adjacent developer software, not identical renovation scope. | Optional lead → quote → signed contract → onboarding funnel with carefully separated B2C and contractor internal finances; later, developer/insurance partner workflows. |

**Priority rule:** retain strong existing RENOVA refund/dispute, plan-fact and work quality contracts; improve customer protection ahead of adding commodity modules. Any purchased third-party feature, licensed UI, or proprietary source requires authorization. Competition evidence is factual capabilities, not a superiority score.

## 11. Client consent coverage: implementation candidate #759 (non-authorizing)

**Code chain:** customer Budget summary → `CustomerConsentCoveragePanel` → typed `osApi.customerConsentCoverage` → `GET /projects/{project_id}/consent-coverage` with project ACL **and actual project customer ID** → `client_consent_coverage_service.consent_coverage_snapshot` → current Payment/Expense/Purchase/PurchaseItem/MaterialPick/WorkOrder/ChangeOrder/Stage/Receipt objects. This path is **READ ONLY**, never commits, grants permission, acknowledges an external transfer, creates Expense, modifies plan/actual, or delivers notification. Admin/contractor/project outsiders cannot access customer audit. Diagnostic references are checked against the requested project, including when an Expense contains more than one source field.

**Honest classification:** evidence `missing`, `partial`, `broken` or `unknown`; financial consent **never** reported fully proven without a versioned customer authorization ledger. A valid payment/stage/approved material pick is *workflow* evidence, not an approved financial exposure. Database orphan/cross-project links are separately treated as critical technical defects. Existing historical records remain visible and may need manual reconstruction, never silently assigned automatic approval.

**Limits:** bounded per-table scan up to 1 000 rows and 120 ordered visible entries, with explicit `scan_truncated`/`items_limited`. Project finance totals are **not additive** across Payment, Expense and Purchase; `recognized_expense_fact_rub` is only sum of `confirmed` Expense rows and not proof of approval or actual cash settlement. Read-consistency is **best effort, not an atomic PostgreSQL point-in-time snapshot**. The customer UI guards stale/out-of-order responses and shows no financial data from another project on route changes. An API error never appears as a zero-risk or fully approved result.

**Evidence:** integration tests for customer/contractor/outsider ACL, source cross-project integrity, compound source IDs and outbox read-only behavior; source-level mobile UI contract in existing `mobile:test`. Exact new SHA CI/Pytest and real browser actions required before the feature is qualified. This candidate does **not** yet block any new customer-payable Payment/Purchase/Expense transaction; immutable WorkScopeVersion, CustomerConsent, FinancialAuthorization allocations, live bank/provider reconciliation remain P0 #757.

**Main, staging and production:** HOLD. No cost-bearing services or DB migrations for this advisory slice.

## 12. Adjacent Russian enterprise patterns (verified official descriptions, not direct B2C equivalents)

| Reference system | Verified source feature | RENOVA capability to plan, with customer-first safeguard |
| --- | --- | --- |
| [1С:ERP Управление строительной организацией](https://solutions.1c.ru/catalog/uso2/features) | Estimate-based work schedules, labor/material/equipment resources, baseline and alternative Gantt scenarios, work-package accounting and plan-fact analysis. | P1 contract baseline vs actual scenario, named subcontractors and resource quantities for each work package, impact preview *before* customer-approved dates or caps change; optional import/export, no attempt to silently replace customers' accounting software. |
| [ГРАНД-Смета 2026](https://grandsmeta.ru/product-grand-smeta) | Normative construction estimate calculations and performed-work accounting, with 2026.2 product revisions. | P2 selectable cost-estimation methodology with provenance/version, only for relevant contract types; do **not** present a normative price as a negotiated fixed contract price or claim legal equivalence without engineering review. |
| [nanoCAD BIM Строительство](https://nanocad.ru/products/bim/stroitelstvo/) | Model geometry, updated specifications, areas/lengths/volumes and dynamic drawings. | P2 IFC/BIM element GUID → room/work-order measurement → estimate quantity, hash/version the measurement origin and request renewed customer consent when altered quantities change contracted price. |
| [Битрикс24 invoice business process](https://helpdesk.bitrix24.ru/open/2215233/) | Multi-stage internal invoice approval followed by accounting payment and collection of supporting documents. | P1 internal validation (foreman → purchasing → finance) and overdue decisions **in addition to** mandatory separate authenticated project-customer approval; accounting post-payment documents never retroactively manufacture customer consent. |

All integrations require explicit API/data-export contracts, license review and provenance classification. No claim of current RENOVA deployment or license to reproduce external implementation.
