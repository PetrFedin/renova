# RENOVA — архитектура будущих внешних интеграций

**Статус:** ACTIVE / AUTHORITATIVE INTEGRATION ANNEX.
**Режим текущего этапа:** внешние реальные сервисы **НЕ АКТИВИРУЮТСЯ**. Разрешены `off` и контролируемый `simulated` только там, где это допускает runtime policy.
**Цель:** подготовить RENOVA так, чтобы ЮKassa, ФНС/НПД, Контур/Госключ, SMS/push, ритейлеры, банки и иные партнёры подключались адаптером и квалификацией, а не переписыванием product/domain logic.

---

# 1. Главный архитектурный принцип

RENOVA владеет **правдой ремонта**. Внешний провайдер владеет только своей внешней операцией/решением.

```text
RENOVA domain intent
  → provider-neutral port
  → adapter
  → external system
  → webhook/status/poll
  → reconciliation
  → verified provider fact
  → allowed RENOVA domain transition
```

Запрещено:

1. хранить provider-specific status как основной lifecycle доменной сущности;
2. считать HTTP 200/redirect фактом оплаты, подписи, проверки ФНС или решения банка;
3. называть timeout `failed` либо `success`, если authoritative result неизвестен;
4. повторять внешнюю mutation новым idempotency key после ambiguous response;
5. передавать партнёру весь Project «на всякий случай»;
6. делать банк/ритейлер/ФНС/Контур обычным `ProjectParticipant`;
7. смешивать Payment, Expense, Receipt, provider fee, refund и financing;
8. включать реальный адаптер без отдельного sandbox/staging/negative/reconciliation evidence.

---

# 2. Общий внешний operation contract

Для любого effectful provider flow нужен durable operation journal. Конкретное имя таблицы/класса определяется implementation audit; если существующий provider-operation механизм покрывает контракт, второй не создаётся.

Минимальные поля концепта:

- `operation_id` — внутренний immutable id;
- `provider_kind` — payment/fiscal/esign/sms/push/retail/financing/...;
- `provider_name` — concrete adapter только как metadata;
- `actor_id` / system actor;
- `project_id` / resource scope если применимо;
- `domain_resource_type/id`;
- `client_request_id` / idempotency identity;
- canonical request fingerprint;
- external operation/reference id;
- state;
- attempt count;
- `last_provider_status` + as-of;
- terminal/reconcile reason;
- created/updated timestamps;
- trace/audit correlation id.

Target state model:

```text
intent_created
  → dispatched
  → provider_pending
  → succeeded
  → failed_final

ambiguous timeout / broken response
  → unknown_reconcile
  → authoritative provider read/webhook
  → succeeded | failed_final | still_pending

succeeded operation, where domain permits reversal
  → reversal_requested
  → reversal_pending
  → reversed | reversal_failed_final | reversal_unknown_reconcile
```

`unknown_reconcile` — нормальное контролируемое состояние, а не исключение, которое UI скрывает.

---

# 3. Универсальные требования к adapter/port

Каждый port определяет:

1. provider-neutral request/response contract;
2. idempotency semantics;
3. timeout semantics;
4. retryable vs terminal errors;
5. authoritative status-read method;
6. webhook/event verification contract если есть;
7. reconciliation method;
8. cancellation/reversal/refund semantics если есть;
9. health/readiness capability;
10. redaction/logging rules;
11. rate-limit handling;
12. mapping provider status → internal provider fact, не напрямую → arbitrary domain state.

Каждый adapter обязан проходить один и тот же contract-test suite своего port. Simulator обязан реализовывать **тот же contract**, включая pending, timeout, duplicate/out-of-order event, terminal failure и reconciliation — иначе simulator превращается в demo shortcut.

---

# 4. Provider modes

Целевой единый режим:

- `off` — capability недоступна, UI не обещает действие;
- `simulated` — полноценный contract simulator для local/test; запрещён там, где runtime policy требует real;
- `real` — конкретный adapter, credentials + preflight + external qualification.

Правила:

- `real` без обязательной конфигурации → fail-start/fail-readiness;
- `simulated` в production/staging, где он запрещён policy → fail-start;
- capability endpoint/readiness сообщает **режим и доступность**, но не раскрывает секреты;
- UI строит CTA по server capability, а не по hardcoded environment assumption.

---

# 5. ЮKassa / PaymentProvider

## 5.1. RENOVA truth

`Payment` — внутренняя бизнес-сущность платежного требования/движения. Provider operation — внешняя попытка/операция. `Expense` признаётся только по отдельно определённому финансовому контракту. `Receipt` — отдельная fiscal/evidence truth.

## 5.2. Provider port

Минимально:

- create/prepare payment;
- get authoritative payment status;
- cancel where supported;
- refund/full/partial where supported;
- get refund status;
- verify/normalize webhook;
- provider idempotency identity;
- fee/metadata mapping only where actually available.

## 5.3. Flow

```text
RENOVA Payment pending
→ durable ProviderOperation
→ PaymentProvider.create
→ external pending
→ redirect/SDK if required
→ webhook and/or authoritative status read
→ reconciliation
→ RENOVA payment transition
→ finance side effects exactly once
```

Lost redirect, duplicate webhook, out-of-order webhook and timeout after provider commit are mandatory negative tests.

Safe-deal/reserved-funds/escrow-like mechanics — **отдельный будущий regulated product contour**. Их нельзя имитировать обычным Payment status.

---

# 6. ФНС / НПД

Нужны независимые ports:

### `FiscalReceiptProvider`

- submit/verify receipt data where lawful/API-supported;
- status/read;
- mismatch/not-found/late/offline correction;
- authoritative timestamp/source.

### `NpdStatusProvider`

- status check with explicit as-of;
- active/inactive/unknown;
- provider/source provenance;
- TTL/revalidation policy.

Rules:

- Payment ≠ Expense ≠ Receipt;
- отсутствие ответа ФНС ≠ «чек неверный»;
- simulator never produces UI claim «проверено ФНС»;
- contractor eligibility may consume NPD fact only under explicit policy and freshness requirement;
- historical fact retains source/as-of even if later status changes.

---

# 7. Контур / Госключ / ESignProvider

RENOVA owns:

```text
Document
→ immutable Version (content hash)
→ SignerIntent
→ provider operation
→ provider signature/status
→ verification/reconciliation
→ SignatureFact
```

Port must support, where provider allows:

- initiate signing of exact immutable version/hash;
- obtain provider session/deeplink;
- authoritative status;
- cancel/expire;
- retrieve signature/certificate metadata necessary for verification;
- webhook normalization;
- reconciliation.

Rules:

- changing document content creates a new version;
- signature is always tied to exact version/hash;
- redirect to provider is not signed state;
- timeout is reconcile state;
- signer identity and authority revalidate before initiation;
- external provider identifiers are references, not primary domain identity.

---

# 8. SMS / Push / Email notification providers

Notification is a **delivery channel**, not business truth.

Port contract:

- enqueue/send with stable delivery intent;
- external message id;
- provider accepted/rejected;
- delivery receipt where supported;
- retry classification;
- rate limiting;
- unsubscribe/consent where legally required.

Business event/outbox is durable before channel delivery. Failed push/SMS does not remove inbox item or domain event.

OTP delivery has stricter abuse/rate/expiry rules and не использует generic marketing notification flow без отдельной policy.

---

# 9. Ритейлеры / поставщики

RENOVA не должна начинать интеграцию с «встроить чужой каталог». Правильная точка — структурированный спрос проекта.

## 9.1. Internal demand graph

```text
Room/Stage
→ MaterialNeed / approved MaterialPick
→ quantity + unit + required-by + delivery constraints
→ provider-neutral OfferRequest
```

## 9.2. Future ports

### `CatalogProvider`
- search/resolve external SKU;
- product attributes/media references;
- current source/as-of.

### `OfferProvider`
- price;
- stock/availability;
- region/store;
- delivery promise/window;
- quote/offer id + TTL;
- commercial conditions.

### `RetailOrderProvider`
- create order from explicit RENOVA Purchase intent;
- authoritative order status;
- cancellation where allowed.

### `FulfillmentProvider`
- shipment/delivery events;
- partial quantities;
- proof of delivery where supplied.

### `ReturnProvider`
- return/replacement intent;
- accepted quantity;
- status;
- refund reference if provider emits it.

## 9.3. Data authority

- retailer SKU = external reference;
- MaterialPick/material requirement remains RENOVA project truth;
- Offer is time-bound market fact, not approved project cost forever;
- Purchase is RENOVA commitment/order projection;
- `paid` and `delivered` are independent dimensions;
- returns/replacements never overwrite original delivery history.

---

# 10. Банки / FinancingProvider

RENOVA does **not** underwrite credit and does not compute an undocumented proprietary credit score.

## 10.1. Consented application envelope

Possible fields only after product/legal approval:

- requested amount;
- approved/revised budget snapshot;
- project stage/milestone summary;
- contractor/contract facts where lawful;
- accepted progress;
- recognized actual/payment summary where user explicitly consents;
- purpose/category;
- minimum identity/contact data required by partner.

## 10.2. Port

- create financing/application session;
- return offer/session/deeplink;
- authoritative application state;
- expiry;
- provider decision metadata that may legally be displayed;
- revoke/withdraw where supported.

Bank owns KYC, underwriting, pricing and credit decision. Rejection/timeout never changes Project/Acceptance/Expense truth.

---

# 11. Государство / регулируемая инфраструктура

RENOVA может стать источником **структурированных пользовательских данных**, но не автоматически государственным reporting agent.

Any future state integration requires:

1. explicit legal basis/purpose;
2. minimal data schema;
3. user/organization consent where required;
4. exact authority/role;
5. audit of export/request;
6. retention/deletion rules;
7. provider authentication/certificates;
8. reconciliation;
9. user-visible status where relevant;
10. security/privacy review.

Никакой «автоматической передачи проекта государству» в core нет.

---

# 12. Partner data envelope

Партнёр не получает generic project read. Для каждой интеграции создаётся purpose-bound envelope:

```text
Envelope {
  purpose,
  subject/resource refs,
  consent/legal_basis ref,
  schema_version,
  generated_at,
  data_as_of,
  minimal payload,
  integrity hash,
  expiry/retention policy,
  correlation_id
}
```

Envelope generation must be auditable and deterministic for the same source snapshot. Sensitive fields are excluded by default.

---

# 13. Webhook / inbound event gateway

Каждый provider webhook проходит:

1. authenticate/verify signature/source;
2. size/schema validation;
3. normalize provider event;
4. dedupe by provider event identity + payload fingerprint;
5. persist inbound receipt/audit where contract requires;
6. lock/revalidate target resource;
7. process idempotently;
8. trigger domain transition only if transition allowed;
9. outbox downstream effects atomically with domain mutation;
10. return provider-compatible response;
11. duplicates/out-of-order remain safe.

Unknown external id does not silently create an unrelated domain resource.

---

# 14. Reconciliation workers

Webhook is acceleration, not sole truth. For each money/signature/fiscal/order flow where provider supports authoritative reads:

- scan pending/unknown operations;
- claim with lease/fencing;
- perform authoritative read;
- compare provider result with RENOVA state;
- repair only via canonical transition service;
- produce audit/outbox;
- terminal unresolvable mismatch → operator queue/DLQ;
- retry with bounded backoff/rate policy.

Operator replay uses same original operation identity; it does not mint a fresh business action unless explicitly chosen as a new user intent.

---

# 15. Operator UX for integrations

Минимальный operations cockpit later:

- provider/mode/health;
- pending/unknown/failed-final counts;
- operation details with redacted payload metadata;
- last authoritative status/as-of;
- retry/reconcile/replay eligibility;
- DLQ/reason;
- domain resource link;
- audit trail;
- no raw secret display.

Manual operator action must be permissioned and auditable.

---

# 16. Disconnect / provider migration

RENOVA must survive provider replacement.

- old external references remain historical;
- active pending operations finish/reconcile under originating adapter/version;
- new operations can use new adapter after controlled cutover;
- domain data is not rewritten to new provider IDs;
- adapter version/schema compatibility documented;
- rollback/cutover runbook required for real activation.

---

# 17. Contract tests for every real provider

Before real activation:

1. happy path;
2. validation failure;
3. rate limit;
4. timeout before commit where distinguishable;
5. timeout after possible provider commit;
6. duplicate request same idempotency key;
7. same key different payload conflict/local prevention;
8. duplicate webhook;
9. out-of-order webhook;
10. provider pending for long period;
11. authoritative reconciliation;
12. refund/cancel/reversal where applicable;
13. credential/config failure;
14. webhook authentication failure;
15. secret/log redaction;
16. provider unavailable/degraded UI;
17. exact staging artifact;
18. rollback/disable mode.

Provider is not called `VERIFIED` from simulator contract alone.

---

# 18. Integration Definition of Ready

A real provider project may start only when:

- internal domain lifecycle is already coherent;
- port contract exists;
- simulator/contract tests cover full lifecycle;
- all calls go through registry/port or migration task explicitly removes bypasses;
- idempotency/reconciliation design exists;
- provider data mapping is documented;
- security/legal/privacy owner requirements are recorded;
- UX knows pending/unknown/failure states;
- secrets/runtime policy is defined;
- staging evidence plan exists.

# 19. Integration Definition of Done

Real integration is DONE only when:

- sandbox/staging adapter tests green;
- external credentials are managed outside repo;
- webhook/auth verified;
- pending/timeout/reconciliation proven;
- duplicate/out-of-order events proven safe;
- domain side effects exactly once;
- provider disable/degradation works;
- operator recovery works;
- user-visible provider claims are truthful;
- privacy/legal/security requirements accepted;
- production readiness evidence updated for exact artifact;
- real provider activation is explicitly approved by owner/release process.

---

Эта архитектура позволяет сейчас строить полноценную RENOVA на внутренних доменных контрактах и симуляторах, а позже подключать ЮKassa, ФНС, Контур, Госключ, ритейлеров и банки как сменяемые внешние capability providers без появления demo-тупиков и без переписывания ядра ремонта.