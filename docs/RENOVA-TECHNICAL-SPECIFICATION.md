# Renova — живое техническое задание и системная спецификация

**Статус документа:** ACTIVE / LIVING SPECIFICATION  
**Язык:** русский  
**Дата базовой ревизии:** 2026-08-28  
**Ветка базовой проверки:** `feat/manual-payment-evidence-lifecycle`  
**Текущий schema head в этой редакции:** `w19paymentevidence01`  
**Текущий verification status:** `PENDING REVERIFY`  
**Назначение:** единый технический паспорт продукта, архитектуры, данных, экранов, процессов, интерфейсов, расчётов, runtime, тестов, evidence, известных разрывов и плана развития Renova.

> `AGENTS.md` остаётся единственным authoritative engineering-policy. Этот документ фиксирует продуктовый/system canon; детальные контракты находятся в `docs/technical-spec/` и являются частью живого ТЗ.

Детальный журнал изменений и roadmap: `docs/technical-spec/CHANGELOG-ROADMAP.md`.  
Расчёты: `docs/technical-spec/CALCULATION-REGISTRY.md`.  
Экраны: `docs/technical-spec/SCREEN-CONTRACT-CATALOG.md`.  
Manual payment evidence: `docs/technical-spec/MANUAL-PAYMENT-EVIDENCE-CONTRACT.md`.

---

# 0. Доказанность и сопровождение

Уровни: VERIFIED, CI VERIFIED, LOCAL TESTED, STAGING VERIFIED, PRODUCTION VERIFIED, PENDING REVERIFY, TBD/UNVERIFIED, HISTORICAL. Green более старого SHA не переносится на новый candidate.

Любое изменение route/API/ORM/Alembic/finance/ACL/UI/runtime/outbox/provider/E2E требует синхронизации этого dossier или профильного annex и exact-head проверки.

## 0.1. Текущий source snapshot

| Source | Blob SHA | Назначение |
|---|---|---|
| `AGENTS.md` | `31820f115d6fade04d7ddb580201c9d8a29b3648` | engineering canon |
| `backend/app/api/v1/router.py` | `a9ebc3fa5adfa2dbb4620497370626d33fe29f41` | canonical API composition incl. payment evidence |
| `apps/mobile/lib/routeRegistry.ts` | `0c9a386486f61cd1a284d8bd7fc99368b557232f` | mobile route truth |
| `backend/alembic/versions/w18nativeenumparity01_remaining_native_enum_parity.py` | `d210b757441efedf7c3e7959ba45321f02962dc4` | native enum parity |
| `docs/technical-spec/MANUAL-PAYMENT-EVIDENCE-CONTRACT.md` | current branch | #265 authoritative annex |

---

# 1. Product/runtime canon

Renova — платформа управления ремонтом для customer/contractor/team/technical supervisor/admin. Canonical mobile IA: Главная → Объект → Ремонт → Бюджет/Деньги → Сообщения; Calendar secondary. PostgreSQL — authoritative business truth; Redis — coordination; S3-compatible storage — durable media; API replica disposable; durable jobs выполняет worker через DomainOutbox/provider reconciliation.

Critical mutation invariant:

```text
authoritative mutation + audit/activity + DomainOutbox + idempotency = one business transaction
```

Financial semantic separation неизменна: Estimate ≠ Commitment ≠ Purchase ≠ Expense ≠ Payment ≠ Receipt ≠ Refund ≠ Change Order. `Project.budget_spent` не является отдельным финансовым writer/source of truth.

---

# 2. Database truth

Current Alembic head: **`w19paymentevidence01`**.

`w16` repair: purchase/material-pick/selection legacy statuses → native enums.  
`w17`: `chatmessagetype` parity.  
`w18`: Notification/JobLead/Payment native-enum parity.  
`w19`: versioned private `PaymentEvidence` lifecycle for manual bank-transfer verification.

`w19` вводит authoritative evidence metadata/history с unique `(payment_id, version)` и `storage_key`; rejected evidence не переписывается, resubmit создаёт следующую версию.

---

# 3. Finance and manual bank-transfer evidence (#265)

Status on PR #297: **IMPLEMENTED / PENDING EXACT-HEAD QUALIFICATION**.

Canonical chain:

```text
customer Payment
→ stable private PaymentEvidence upload intent
→ exact private object key
→ server read-back + magic/MIME/size/SHA-256 validation
→ submitted evidence
→ Payment.paid_unverified (non-financial)
→ authorized admin review
→ approve OR reject(reason)
→ approve: Payment.confirmed
→ existing payment-linked Expense recognition exactly once
→ budget facts refresh
→ PaymentEvent + DomainOutbox
```

Private key shape:
`payment-evidence/{project_id}/{payment_id}/{evidence_id}/v{version}.{ext}`.

Generic public `photos/*` is forbidden for payment evidence. Dedicated API owns upload/read authorization and exact payment/project binding. JPEG/PNG/PDF are accepted only after server-side content validation; declared MIME/extension alone are insufficient. Max evidence size is 10 MiB.

Review authority is the existing administrative identity contract (`ADMIN_USER_IDS`/admin guard); ordinary contractor role alone does not grant review power. Reject requires a reason. Rejected evidence remains historical and customer resubmission creates N+1.

Approval reuses canonical `payment_service.confirm_payment(... reviewed_evidence_id=..., commit=False)`. Only transition to `confirmed` invokes `expense_from_payment()` and `refresh_budget_facts()`. No new direct `budget_spent` writer exists.

Approve/reject decision uses conditional PostgreSQL transition from `submitted`; duplicate/concurrent decisions must have one winner. Mandatory remaining qualification: real two-session PostgreSQL approve↔reject and duplicate-approve proof, mobile/read-model truth, focused/full regression, exact-head CI.

S3/PostgreSQL do not share a transaction. Durable upload intent makes ambiguous writes identifiable; generic provider-independent orphan/ambiguous-write reconciliation remains issue #238 and is **NOT VERIFIED** by #265.

---

# 4. API truth relevant to #265

All routes are under `/api/v1`.

Finance includes payment disputes/history/checkout/payments, payment evidence, estimates/change orders, bank import/export, receipts, purchases and expense mutations.

Payment evidence routes are composed by `backend/app/api/v1/router.py` through `payment_evidence.router`; no legacy duplicate finance writer is introduced. Dedicated endpoints cover upload intent, exact-key upload in canonical local mode, submit, list/read, approve/reject and resubmission lifecycle as defined by the annex.

---

# 5. Mobile truth

Canonical route registry remains `apps/mobile/lib/routeRegistry.ts`; no new top-level payment-evidence tab is allowed. Manual-transfer evidence belongs to Budget/Payments surfaces.

Required user-visible states for #265:

```text
upload required
upload pending / retryable
submitted / pending review
rejected + reason + resubmit
confirmed
terminal cancelled/disputed/refunded
```

`paid_unverified` must be visible as pending verification and must never be counted as confirmed spend. Ambiguous network/server failures must not render success.

---

# 6. Runtime/readiness boundary

Canonical local topology: PostgreSQL + Redis + MinIO + migrate + renova-api + renova-worker + optional Expo. Startup migrations fail closed. API startup never seeds/reset business data. External staging/provider/DR/observability/security evidence remains governed by `PRODUCTION-READINESS.md` and `docs/production-readiness-evidence.json`.

Broad production status remains **BLOCKED_FOR_BROAD_PRODUCTION**. #265 cannot promote #233/#234/#235/#238/#247/#256/#257 or controlled-pilot evidence.

---

# 7. Current qualification sequence

1. synchronize w19/schema/API/readiness truth;
2. focused backend evidence lifecycle tests;
3. real PostgreSQL approve↔reject and duplicate-approve race;
4. mobile/read-model states and retry/no-false-success contracts;
5. full backend + Alembic PostgreSQL + Playwright/mobile regression;
6. exact-head CI;
7. merge #297 only after green exact head;
8. post-merge readiness/ТЗ evidence reconciliation;
9. proceed to provider/S3 recovery #238.

No implementation-in-progress SHA is production evidence until this sequence is complete.
