# Renova — живое техническое задание и системная спецификация

**Статус документа:** ACTIVE / LIVING SPECIFICATION  
**Язык:** русский  
**Дата базовой ревизии:** 2026-08-28  
**Ветка базовой проверки:** `fix/canonical-local-runtime-agents`  
**Текущий schema head в этой редакции:** `w18nativeenumparity01`  
**Текущий verification status:** `PENDING REVERIFY`  
**Назначение:** единый технический паспорт продукта, архитектуры, данных, экранов, процессов, интерфейсов, расчётов, runtime, тестов, evidence, известных разрывов и плана развития Renova.

> `AGENTS.md` остаётся единственным authoritative engineering-policy для Cursor, Claude Code и других coding agents. Этот документ — authoritative product/system dossier: он фиксирует **что существует, как связано, как должно работать, какие состояния допустимы, какими источниками и тестами это подтверждается и что ещё не доказано**. При конфликте описания с текущим кодом/миграцией/route registry/CI конфликт считается дефектом документации или implementation и должен быть устранён до повышения статуса evidence.

Детальный журнал изменений и приоритизированный roadmap: `docs/technical-spec/CHANGELOG-ROADMAP.md`.  
Детальный реестр расчётов: `docs/technical-spec/CALCULATION-REGISTRY.md`.  
Детальный каталог экранов: `docs/technical-spec/SCREEN-CONTRACT-CATALOG.md`.  
Source snapshot экранов: `docs/technical-spec/SCREEN-SOURCE-SNAPSHOT.md`.

---

# 0. Правила доказанности и сопровождения

## 0.1. Уровни доказанности

- **VERIFIED** — подтверждено текущим source/config/migration;
- **CI VERIFIED** — подтверждено успешным CI для конкретного exact SHA;
- **LOCAL TESTED** — подтверждено canonical local runtime;
- **STAGING VERIFIED** — подтверждено retained evidence реального staging;
- **PRODUCTION VERIFIED** — подтверждено retained evidence production;
- **PENDING REVERIFY** — implementation изменён после последнего успешного доказательства;
- **TBD / UNVERIFIED** — точное поведение/значение ещё не доказано;
- **HISTORICAL** — исторический факт, не являющийся текущим каноном.

Green более старого SHA не переносится автоматически на новый candidate.

## 0.2. Обязательное правило обновления ТЗ

Изменение любого из следующих классов требует проверки и обновления этого dossier или соответствующего annex в том же рабочем контуре:

1. route registry, tab layout, deeplink, redirect;
2. API method/path/schema/auth/error/idempotency;
3. ORM entity, Alembic schema, enum, constraint, lifecycle/status;
4. financial recognition/calculation;
5. role/ACL/security boundary;
6. shared UI token/component;
7. screen/hub/filter/action/state;
8. local/staging/production runtime topology;
9. health/readiness/worker/outbox/provider flow;
10. E2E/user journey/release gate;
11. demo/local data lifecycle, seed/reset/bootstrap;
12. technical-spec traceability/drift contract.

## 0.3. Обязательный рабочий цикл развития

```text
прочитать master dossier + CHANGELOG-ROADMAP + relevant annex
→ проверить current code / migrations / CI / external evidence
→ выбрать верхний незакрытый P0/P1
→ реализовать bounded change
→ одновременно обновить ТЗ/annex
→ добавить или усилить automated proof
→ получить exact-head validation
→ записать evidence/status/residual risk
→ только затем переходить к следующему пункту
```

Нельзя наращивать cosmetic backlog при существующем доказанном P0 correctness/data-loss/runtime blocker.

## 0.4. Проверенный source snapshot

Blob SHA — traceability anchor. При изменении tracked source документация обязана обновляться.

| Source | Blob SHA | Что подтверждает |
|---|---|---|
| `AGENTS.md` | `31820f115d6fade04d7ddb580201c9d8a29b3648` | engineering/runtime/security/DoD canon |
| `backend/app/api/v1/router.py` | `fe0e66377eb57ba968e91370267a8f5cf812a3fa` | API composition/canonical route replacement |
| `backend/app/models/entities.py` | `f2e63f316fa8c9b2012894ae4e496dc76a73a3a1` | ORM/domain entities/status/enum mappings |
| `backend/app/main.py` | `223e83b13f96398eefe997275ac6f41fa44bfbcf` | API lifespan; startup без demo business-data mutation |
| `backend/app/services/seed_demo.py` | `c62ba920130a7ba7f6e2bd0a54e63feadce5c6cd` | explicit additive demo seed; canonical-demo-only chat dedupe |
| `backend/scripts/verify_orm_schema_parity.py` | `ba08d0681df301f446b3adbf811ad9367eeb24b9` | ORM ↔ PostgreSQL table/column/native-enum parity |
| `backend/scripts/verify_current_migration_schema.py` | `13e63544564b41a13c52f9437b9bfbdfa290913b` | current migration-owned reflected enum invariants w16–w18 |
| `apps/mobile/lib/routeRegistry.ts` | `0c9a386486f61cd1a284d8bd7fc99368b557232f` | mobile IA/routes/audience/visibility/redirects |
| `apps/mobile/constants/Theme.ts` | `6e66c4bf0db8c9d1b8c4a2d0355311145ca43b20` | colors/spacing/radius/font sizes/touch target/card baseline |
| `apps/mobile/constants/typography.ts` | `8a96b7f290944ac2c566c0f1791c1f60ab90c68a` | semantic typography |
| `apps/mobile/constants/screenTypography.ts` | `f91c9a659a1ab8603ae4d82eb46d76754627b5bb` | hub/list/filter typography and geometry |
| `apps/mobile/constants/uiTokens.ts` | `ca2d8e9e03f56efb058041ad8a81c04d15c7a8a0` | chips/surfaces/input field |
| `apps/mobile/constants/screenLayout.ts` | `0165f3c86d829311e91ac17b875c23ccaefab12b` | screen padding |
| `apps/mobile/components/renova/os/OsHubTabs.tsx` | `f480067b06c750623e4091fe0db128c877e3fb37` | hub-tab progressive disclosure/geometry |
| `apps/mobile/components/screens/OsObjectHubScreen.tsx` | `3082b1bf59cbf420d403ed82b35bbc2e78697728` | Object hub composition |
| `apps/mobile/components/screens/OsRepairHubScreen.tsx` | `5fe0e6229ad4cc82462ea4cfc1f7d213c7687305` | Repair hub composition/badges/deeplinks |
| `apps/mobile/components/screens/OsBudgetHubScreen.tsx` | `4e0e8267d68b600cf0d8bdf716a4c8eddaa3bcbd` | Budget hub composition |
| `apps/mobile/constants/budgetTabs.ts` | `d02c05560176535e130d76960c2b67691bcbb3b7` | Budget tabs/legacy normalization |
| `.cursor/rules/renova-design-system.mdc` | `2f48e46f5b348b8cbc3a370615a5a5e93d93421f` | mobile UI implementation rules |
| `package.json` | `4c95fcf89d7e29f1c464a7db2c7aa4c85335fe11` | root scripts/test entry points |
| `.github/workflows/local-runtime-integrity.yml` | `3ae00fa13be960bf7acba71c8cfa41134d35e16f` | canonical local start/check/double-seed/focused proof chain |
| `backend/alembic/versions/w16legacystatus01_legacy_status_enum_parity.py` | `d2137f2b87c1ac6f679093331bd034aff17c8188` | legacy VARCHAR status → native enum repair |
| `backend/alembic/versions/w17chatmessageenum01_chat_message_enum_parity.py` | `0537268c85e26b7a607d36f967a3402b8bba53c4` | chat message PG enum → current ORM labels |
| `backend/alembic/versions/w18nativeenumparity01_remaining_native_enum_parity.py` | `d210b757441efedf7c3e7959ba45321f02962dc4` | remaining Notification/JobLead/Payment native-enum parity |
| `docs/technical-spec/CHANGELOG-ROADMAP.md` | `82ba22fff35793551a6a838f139293ad3c5bbbba` | governed change history and prioritized roadmap |

---

# 1. Назначение продукта и границы системы

**VERIFIED.** Renova — production-oriented платформа управления ремонтом для заказчика и исполнителя. Архитектура строится вокруг общего `Project` и сквозных доменных связей, а не набора независимых mini-app экранов.

Основные роли:

- customer / заказчик;
- contractor / исполнитель;
- team/viewer участники;
- technical supervisor / технический надзор;
- admin/operator для ограниченных административных и recovery-операций.

Наличие роли не означает автоматическую доступность любого route; фактические права определяются API guards, project membership/ownership, role-aware screen contracts и ACL tests.

## 1.1. Главная информационная архитектура

Canonical mobile IA:

```text
Главная
→ Объект
→ Ремонт
→ Бюджет/Деньги
→ Сообщения
```

`Сроки` — отдельный Calendar hub, доступный как optional/secondary entry. Документы, согласования, входящие, отчёты, закупки, подборы, приёмка и аналитика входят через канонические hubs/deeplinks/redirects и не должны дублировать top-level navigation.

---

# 2. Репозиторий и источники истины

## 2.1. Engineering policy

**VERIFIED:** `AGENTS.md`.

`CLAUDE.md` и общие Cursor rules — pointer/bootstrap, а не второй независимый набор engineering-policy.

## 2.2. Product/navigation truth

**VERIFIED:** `apps/mobile/lib/routeRegistry.ts` + Expo Router implementation.

## 2.3. API truth

**VERIFIED:** `backend/app/api/v1/router.py` + concrete routers/services.

Canonical route replacement удаляет старые shadow handlers через `_remove_replaced_routes(...)`, чтобы import order не менял фактический API.

## 2.4. Database truth

**VERIFIED:** SQLAlchemy ORM + линейный Alembic graph. PostgreSQL — authoritative durable store для staging/production. SQLite не доказывает production native-enum, locking, constraints или concurrency semantics.

Current revision: **`w18nativeenumparity01`**.

## 2.5. Readiness truth

`PRODUCTION-READINESS.md` и `docs/production-readiness-evidence.json` управляют broad production-readiness claims. Green local/CI не заменяет внешний staging/production/provider evidence.

---

# 3. Runtime architecture

## 3.1. Процессы и зависимости

```text
Mobile / Web / external callbacks
             |
             v
        renova-api
             |
     +-------+--------+
     |       |        |
 PostgreSQL Redis   S3-compatible storage
     ^       ^        ^
     |       |        |
        renova-worker
             |
       external providers
  (только через явные boundaries)
```

- `renova-api`: FastAPI HTTP/WebSocket, auth/ACL, synchronous request handling, API-local Redis bridge/heartbeat;
- `renova-worker`: durable background execution, Domain Outbox, provider reconciliation, reminders/push receipt where enabled, worker heartbeat;
- PostgreSQL: authoritative business state;
- Redis: shared coordination/rate limit/runtime topology/WebSocket bridge where configured;
- S3-compatible storage: documents/media.

**Invariant:** durable business jobs не должны возвращаться в API startup/background tasks. API replica обязана быть disposable без потери pending durable work.

## 3.2. Canonical local topology

```text
PostgreSQL + Redis + MinIO + migrate + renova-api + renova-worker + optional Expo
```

Compose project: `renova-local`.

Canonical commands:

```bash
npm run dev -- doctor
npm run dev -- bootstrap
npm run dev
npm run dev -- check
npm run dev -- seed
npm run dev -- test-focused
npm run dev -- test-full
npm run dev -- logs
npm run dev -- stop
npm run dev -- reset
```

`reset` destructive только для isolated local project/volumes.

## 3.3. Local safety boundary

Canonical local tooling fail-closed при:

- remote `DOCKER_HOST`;
- remote Docker context;
- `ENVIRONMENT=staging|production`;
- непустых external provider credentials/sinks.

Compose дополнительно neutralizes external credentials/sinks внутри local containers.

## 3.4. Startup sequence

```text
local env guard
→ local Docker context guard
→ infra start/health
→ Alembic upgrade head
→ migration guard
→ runtime preflight
→ API + worker
→ /health
→ /ready
→ worker local heartbeat
→ worker shared Redis heartbeat
→ optional Expo
```

Migration/preflight failure не скрывается `|| true` или best-effort логикой.

## 3.5. Startup ≠ seed

**VERIFIED source / PENDING REVERIFY runtime.** API lifespan не создаёт, не удаляет и не переписывает demo business data.

```text
npm run dev
= start runtime only

npm run dev -- seed
= explicit development-only Alembic-head-gated demo materialization
```

Restart/redeploy не является demo-data reset operation.

## 3.6. Explicit seed invariants

`seed_demo.py` обязан быть additive/idempotent:

- не удаляет произвольные project chats;
- не удаляет `work:<id>` domain-owned threads;
- не удаляет E2E/developer thread только из-за неизвестного title;
- может дедуплицировать только собственные canonical demo-title;
- повторный seed сохраняет runtime healthy;
- canonical local CI запускает explicit seed **дважды**.

---

# 4. Data/domain model — системная карта

## 4.1. Core project graph

```text
User
 ├─ owns/participates in → Project
 │   ├─ PropertyObject / Floors / Rooms
 │   ├─ Stages / WorkOrders / WorkSchedules
 │   ├─ EstimateLines / BudgetLines
 │   ├─ MaterialPicks → Purchases → PurchaseItems
 │   ├─ SelectionItems
 │   ├─ Expenses / Payments / Receipts / ChangeOrders
 │   ├─ WorkAcceptances / Issues / Rework
 │   ├─ ChatThreads → ChatMessages / participants / reads
 │   ├─ Documents → OCR / e-sign / lifecycle
 │   ├─ FloorPlans / pins
 │   ├─ Notifications / Activity / Audit
 │   └─ Reports / analytics / KPI history
 └─ auth/session/team/subscription/account lifecycle
```

## 4.2. Financial semantic separation

- **Estimate** — план стоимости/scope;
- **Commitment** — подтверждённое обязательство;
- **Purchase** — procurement/acquisition event;
- **Expense** — признанный расход;
- **Payment** — движение денег/payment state;
- **Receipt** — evidence/первичный документ, не автоматически второй Expense;
- **Refund** — обратное движение денег/economic correction;
- **Change Order** — согласованное изменение scope/budget.

Запрещено универсально дедуплицировать финансовую реальность эвристикой `max(receipt, expense, estimate_fact)`.

## 4.3. Legacy status enum parity — `w16legacystatus01`

| Table | Native enum | Current values | Historical storage |
|---|---|---|---|
| `purchases.status` | `purchasestatus` | draft, approved, ordered, paid, partial, delivered, cancelled, returned | `VARCHAR(32)` |
| `material_picks.status` | `materialpickstatus` | draft, pending, approved, purchased | `VARCHAR(32)` |
| `selection_items.status` | `selectionstatus` | draft, proposed, approved, rejected | `VARCHAR(16)` |

Migration валидирует existing values до cast; unknown value останавливает upgrade. Downgrade возвращает исходные VARCHAR lengths.

## 4.4. Chat message enum parity — `w17chatmessageenum01`

Historical v14 PG `chatmessagetype`:

```text
text | photo | confirm | system
```

Current ORM/mobile:

```text
text | photo | file | confirm | system | task | invoice | payment
```

`w17` принимает только точное legacy либо exact current состояние и fail-closed на неизвестной промежуточной комбинации. Downgrade запрещён, если строки уже используют `file/task/invoice/payment`.

## 4.5. Remaining native enum parity — `w18nativeenumparity01`

Generic ORM/PostgreSQL verifier после clean upgrade до w17 выявил ровно три remaining mismatch.

### 4.5.1. NotificationType

Historical physical PG state:

```text
stage_review
payment_pending
change_order
room_change
chat_message
payment_confirmed
```

Current canonical ORM/PG state:

```text
stage_review
stage_started
room_updated
room_created
payment_pending
payment_confirmed
change_order
room_change
chat_message
budget_alert
reaction
materials
approval
issue
deadline
waste_reminder
document
other
```

Root cause: v14 создал 5 labels, отдельная migration добавила только `payment_confirmed`; последующие model labels не имели schema migrations.

### 4.5.2. JobLeadStatus

Historical `w1softdelete01` storage:

```text
job_leads.status VARCHAR(32) DEFAULT 'open'
```

Current canonical storage:

```text
job_leads.status → native jobleadstatus
open | quoted | taken | closed
```

Upgrade валидирует реальные значения до cast и сохраняет server default `open`.

### 4.5.3. PaymentStatus

Historical PG order после v14 + `z0a1b2c3d4e5`:

```text
pending
confirmed
cancelled
processing
paid_unverified
disputed
refunded
```

Canonical ORM/PG order:

```text
pending
processing
paid_unverified
confirmed
cancelled
disputed
refunded
```

Проверенный `payment_service.py` определяет state machine explicit equality/allowed-from sets, а не ordinal comparison. Поэтому historical append order не является business rule. `w18` losslessly rebuilds enum с тем же набором labels в exact canonical order.

### 4.5.4. Fail-closed и downgrade policy

- неизвестный historical enum state — migration failure;
- неизвестный persisted value — migration failure;
- Notification downgrade запрещён, если используются labels, отсутствующие в historical enum;
- JobLead downgrade возвращает `VARCHAR(32) DEFAULT 'open'`;
- Payment downgrade lossless по values и возвращает historical order.

## 4.6. General native-enum parity invariant

`verify_orm_schema_parity.py` для каждой mapped `SQLAlchemy Enum(native_enum=True)` проверяет:

1. column существует;
2. storage действительно PostgreSQL `ENUM`;
3. PG enum type name = ORM enum name;
4. **ordered** PG labels = ORM labels.

Порядок labels считается частью physical schema semantics. Нельзя ослаблять verifier до unordered set comparison ради зелёного CI. Business state machine должна задаваться явными transitions, а не скрытым `<`/`>` по PG enum.

Current migration-owned explicit enum invariants:

```text
purchases.status          → purchasestatus
material_picks.status     → materialpickstatus
selection_items.status    → selectionstatus
chat_messages.message_type→ chatmessagetype
app_notifications.notification_type → notificationtype
job_leads.status          → jobleadstatus
payments.status           → paymentstatus
```

---

# 5. Transaction, idempotency, outbox и provider boundary

## 5.1. Critical mutation rule

Одна business operation должна по возможности иметь одну transaction boundary:

```text
authoritative mutation
+ audit/activity
+ DomainOutbox enqueue
= one committed operation
```

Concurrency-sensitive деньги, acceptance, permissions, scope и provider state требуют DB constraints + locking/fencing/version rule там, где это необходимо.

## 5.2. Durable side effects

```text
business transaction
→ DomainOutbox
→ worker claim
→ provider call
→ retry/backoff
→ success | terminal/DLQ
→ operator recovery/replay with audit
```

Обязательные свойства: deterministic enqueue identity, duplicate prevention, lease ownership, stale lease rescue, fencing/generation где реализовано, bounded retries, terminal state, manual recovery, metrics/health.

## 5.3. Provider reconciliation

`w15providerops01` создаёт durable reconciliation ledger с provider/operation/resource identity, attempts, claim generation, lock, next attempt, terminal/completed/unavailable state и error fingerprint.

Production observability развивается отдельно в PR #283.

---

# 6. API composition

Все API ниже находятся под `/api/v1`.

## 6.1. Content/design/procurement

- design packages;
- marketplace;
- material price sync;
- materials/material picks;
- selections;
- approvals;
- waste orders;
- floor plans;
- work types.

## 6.2. Project execution

- work orders;
- work acceptances;
- issue transitions;
- budget planner;
- activity;
- rework SLA;
- project work schedule / technical supervision schedule;
- stage mutations/review/extensions;
- project checklists/templates/reactions;
- technical supervision/actions.

## 6.3. Documents

- document lifecycle: sign/archive/restore/delete/legal hold;
- project documents;
- e-sign;
- OCR;
- OCR/automation worker boundaries;
- media.

## 6.4. Identity/platform

- account lifecycle;
- OTP auth;
- auth/session;
- push;
- subscription checkout/webhook/integrity/refunds;
- teams;
- analytics;
- audit;
- admin;
- articles/admin articles;
- FNS;
- KPI history;
- notifications.

## 6.5. Project and collaboration

- canonical project creation/from-template;
- projects reader/legacy-compatible routes;
- rooms/room requests;
- calendar integrity/mutations/calendar;
- chat inbox;
- chats;
- technical supervision chat.

Chat message storage enum parity принадлежит #286/schema truth. Chat transaction/idempotency/concurrency hardening остаётся отдельным PR #282.

## 6.6. Finance

- payment disputes;
- payment history;
- payment checkout integrity;
- payments;
- estimate;
- change orders;
- bank statement import/confirm;
- export;
- receipts;
- purchases;
- expense mutations/OS finance surfaces.

---

# 7. Mobile information architecture and navigation

## 7.1. Role architecture

Customer и contractor route groups — тонкие role-aware wrappers над общими `Os*Screen`, а не два независимых продукта. Новая функциональность не должна создавать role-forked duplicate screen, если различия могут быть выражены permissions/capabilities внутри shared screen.

Пример:

```text
(customer)/(tabs)/index.tsx  → OsHomeScreen role="customer"
(customer)/(tabs)/object.tsx → OsObjectHubScreen role="customer"
(customer)/(tabs)/repair.tsx → OsRepairHubScreen role="customer"
(customer)/(tabs)/budget.tsx → OsBudgetHubScreen role="customer"
```

Contractor использует тот же shared screen family с `role="contractor"`.

## 7.2. Canonical route registry

| Route ID | Path | Audience | Visibility | Status | Канонический смысл |
|---|---|---|---|---|---|
| home | `/index` | both | dock | GA | Главная |
| object | `/object` | both | dock | GA | Объект |
| repair | `/repair` | both | dock | GA | Ремонт |
| budget | `/budget` | both | dock | GA | Бюджет/Деньги |
| calendar | `/calendar` | both | deeplink/optional dock | GA | Сроки |
| chat | `/chat` | both | dock | GA | Сообщения |
| manager-dashboard | `/manager-dashboard` | both | more | beta | Управленческая сводка |
| finance-center | `/finance-center` | both | hidden | beta | redirect → Budget/payments + payment sheet |
| control | `/control` | both | hidden | beta | redirect → Repair/control |
| quality-control | `/quality-control` | contractor | deeplink | beta | contractor QC entry |
| work-acceptance | `/work-acceptance` | customer | deeplink | GA | redirect → Repair/control |
| work-schedule | `/work-schedule` | both | hidden | beta | redirect → Calendar |
| documents | `/documents` | both | more | GA | Document Center |
| approvals | `/approvals` | both | more | GA | Согласования |
| notifications | `/notifications` | both | hidden | beta | redirect → Inbox |
| inbox | `/inbox` | both | more | GA | единый attention channel |
| scan-receipt | `/scan-receipt` | both | deeplink | GA | скан чека |
| stage | `/stage/[id]` | both | deeplink | GA | этап работ |
| materials-procurement | `/repair?tab=materials&subtab=purchases` | both | deeplink | GA | procurement hub |
| selections | `/repair?tab=selections` | both | deeplink | GA | подбор чистовых материалов |
| warranty-claim | `/documents` | both | deeplink | beta | гарантия через Document Center |
| design | `/design` | both | hidden | GA | legacy redirect → Object/plan/design |
| conflicts | `/conflicts` | contractor | deeplink | GA | offline sync conflicts |
| portfolio | `/portfolio` | contractor | deeplink | beta | портфель объектов |
| scratchpad | `/scratchpad` | both | deeplink | beta | черновик |
| budget-planner | `/budget-planner` | both | deeplink | beta | планировщик бюджета |
| checklist-templates | `/checklist-templates` | contractor | deeplink | beta | шаблоны чек-листов |
| guide | `/guide` | both | deeplink | GA | справка |
| activity | `/activity` | both | more | GA | история проекта |
| portal | `/portal?token=` | customer guest | deeplink | GA | magic-link portal |
| reports | `/reports` | both | more | beta | daily/weekly/final reports |
| project-analytics | `/project-analytics` | both | hidden | beta | redirect → Budget/deviations |

`MAX_MORE_MENU_ITEMS = 5`. Redirect-only entries не должны раздувать меню «Ещё».

---

# 8. Hub screens — состав, переходы, badges и progressive disclosure

## 8.1. Object hub

Tabs:

1. `rooms` — **Комнаты**, primary/default;
2. `estimate` — **Смета**, primary;
3. `plan` — **План**, secondary;
4. `profile` — **Данные**, secondary.

Subscreens: `OsRoomsScreen`, `OsEstimateScreen`, `OsPlanTabScreen`, `OsProjectProfileScreen`.

`onNextTab/goTab` связывает последовательный flow между subsections без нового top-level route.

## 8.2. Repair hub

Tabs:

1. `works` — **Этапы**, primary/default;
2. `control` — **Приёмка**, primary; badge = pending acceptance count;
3. `materials` — **Материалы**, secondary;
4. `selections` — **Подбор**, secondary при badge=0; badge = pending selections.

Subscreens: `OsWorksScreen`, `OsControlScreen`, `OsMaterialsScreen`, `OsSelectionsScreen`.

Deep links:

- legacy `tab=calendar` → Calendar;
- `subtab=picks|purchases|receipts` → Materials;
- `tab=selections` → Selections.

Badge load failure fail-to-zero + `reportError`, а не ложный positive state.

## 8.3. Budget hub

Tabs:

1. `summary` — **План–факт**, primary/default;
2. `expenses` — **Расходы**, secondary;
3. `payments` — **Оплаты**, primary;
4. `deviations` — **Отклонения**, secondary.

Legacy normalization:

- `rooms` → `expenses` + view=`rooms`;
- `stages` → `expenses` + view=`stages`;
- `analytics` → `deviations`;
- unknown → `summary`.

Expense view type: `list | rooms | stages`.

## 8.4. Home hub

Shared `OsHomeScreen(role)` — orchestration/attention surface, а не копия secondary centers. Полный KPI/action inventory остаётся P1 в `SCREEN-CONTRACT-CATALOG.md`.

## 8.5. Chat

Dock area для обеих ролей.

Persisted message types:

```text
text | photo | file | confirm | system | task | invoice | payment
```

PG parity обеспечивает w17 + generic verifier. Message atomicity/idempotency/ACL/delivery consistency — #282.

---

# 9. UI design system — точные токены

## 9.1. Цвета

| Token | Value |
|---|---|
| primary | `#334155` |
| primaryPressed | `#1E293B` |
| primaryMuted | `#64748B` |
| accent | `#2563EB` |
| accentMuted | `#DBEAFE` |
| background | `#F8FAFC` |
| surface | `#FFFFFF` |
| surfaceMuted | `#F1F5F9` |
| text | `#0F172A` |
| textMuted | `#64748B` |
| textSubtle | `#94A3B8` |
| border | `#E2E8F0` |
| success | `#15803D` |
| warning | `#B45309` |
| danger | `#B91C1C` |
| info | `#1D4ED8` |
| tabActive | `#1E293B` |
| tabInactive | `#94A3B8` |

Operational screens используют shared tokens/UI primitives; локальные hex требуют явного design-system exception.

## 9.2. Spacing

```text
xxs 2
xs  4
sm  8
md 12
lg 16
xl 20
xxl 24
xxxl 32
```

Screen horizontal/base padding: `16`. Bottom content padding: `32`.

## 9.3. Radius

```text
xs 6
sm 8
md 10
lg 12
xl 16
pill 999
```

Base card: radius `12`, padding `12`, border `1`, marginBottom `8`.

## 9.4. Typography

```text
display 32
hero    24
h1      22
h2      18
h3      16
body    14
bodySmall 13
caption 12
tiny    11
tab     10
```

Weights: `400 / 500 / 600 / 700 / 800`.

Semantics:

- screen hero = h1 22 / bold;
- sheet title = h2 18 / bold;
- sheet value = hero 24 / bold;
- section = bodySmall 13 / semibold;
- list title = 15 / semibold;
- list meta = caption 12 / lineHeight 16;
- metric = 20 / bold;
- body lineHeight 20;
- bodySmall lineHeight 18;
- tiny lineHeight 14.

## 9.5. Touch/input

Minimum touch target: **44 px**.

Input:

- minHeight `44`;
- radius `10`;
- border `1`;
- horizontal padding `12`;
- font size `14`;
- surface background.

## 9.6. Filter chips

- flex-wrap;
- gap `6`;
- horizontal padding `10`;
- vertical padding `6`;
- radius `14`;
- border `1`;
- inactive = surface + border;
- active = semantic active surface + primary border;
- label = caption 12 / semibold.

## 9.7. Hub tabs

`OsHubTabs` — underline tabs, не pill-card tabs:

- bottom hairline border;
- row horizontal padding `8`, top `4`, gap `4`;
- tab horizontal padding `12`, vertical `10`;
- active underline `2` primary;
- label `14/500`, active `14/700`;
- badge minWidth/height `16`, radius `8`, horizontal padding `4`;
- badge text `9/800`;
- >9 → `9+`;
- secondary tabs скрываются за `Все`, пока не раскрыты или current value не secondary.

## 9.8. CTA/component rules

- максимум 1 primary CTA на экран;
- максимум 4 hub tabs без progressive disclosure;
- status только semantic `StatusPill`;
- emoji не используются как operational icons; canonical icons — `Ionicons`;
- runtime/dev diagnostics не показываются в user UI;
- primary/outline/danger semantics не смешиваются.

Known consistency debt: часть Technical Supervision control actions использует local `Pressable` styling вместо shared `PrimaryButton`. Это P1 UI-consistency work, а не причина менять runtime/schema PR.

---

# 10. Основные business flows и связи

## 10.1. Создание проекта

```text
authenticated actor
→ canonical project creation / from-template
→ Project
→ object setup (profile/rooms/plan/estimate)
→ execution setup
→ repair stages/work schedule
```

## 10.2. Execution/acceptance

```text
Stage planned
→ start / dates / rooms / work type / dependencies
→ execution
→ submit/review
→ acceptance decision
→ done | rework | reject по state rules
```

Control UI входит через `Ремонт → Приёмка`.

## 10.3. WorkOrder → Chat ownership

`create_work_order()` создаёт thread `work:<work_order_id>` и сохраняет FK `work_orders.chat_thread_id`.

Следствие:

- это domain-owned resource;
- demo seed не имеет права удалять его как «неизвестный чат»;
- generic project-chat purge запрещён;
- удаление/перенос такого thread требует явной domain operation.

## 10.4. Materials/procurement

```text
MaterialPick need
→ approval/readiness
→ Purchase
→ PurchaseItem
→ ordered/paid/partial/delivered/returned/cancelled
→ receipt/evidence
→ expense/payment recognition по finance semantics
```

`MaterialPick`, `Purchase`, `Receipt`, `Expense`, `Payment` не взаимозаменяемы.

## 10.5. Selections

```text
room × category × SKU × allowance
→ draft
→ proposed
→ approved | rejected
→ downstream procurement where applicable
```

UI: `Ремонт → Подбор`; pending badge может поднимать вкладку из secondary disclosure.

## 10.6. Payments

```text
business obligation
→ Payment record/state
→ checkout/provider or documented manual flow
→ pending/processing/paid_unverified/confirmed/...
→ provider/bank reconciliation
→ financial recognition rules
```

State transition разрешения задаются explicit business rules, не ordinal order PostgreSQL enum.

Provider timeout/local UI success не является окончательным подтверждением денег.

## 10.7. Documents

```text
Document Center
→ upload/store
→ metadata/access control
→ OCR where requested
→ sign/e-sign where requested
→ archive/restore/legal hold/delete lifecycle
```

Object storage и document ACL — security boundary.

## 10.8. Chat

```text
Project/authorized thread
→ participant ACL
→ message mutation
→ durable authoritative message
→ delivery/notification side effects
```

## 10.9. Warranty

Warranty — отдельный bounded contour PR #287. Current canonical IA entry: Document Center/deeplink `warranty-claim`.

---

# 11. Calculations and derived state

Детальный реестр: `docs/technical-spec/CALCULATION-REGISTRY.md`.

## 11.1. Currency formatting

`formatRub(amount)` → `Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 })`.

## 11.2. Budget/financial principles

- одна economic operation не признаётся дважды;
- estimate/commitment/purchase/expense/payment/receipt/refund/change order разделены;
- pending/cancel/refund/dispute обрабатываются явно;
- partial/overpayment отражаются там, где применимо;
- provider/bank evidence reconciles payment truth.

Подтверждённые формулы/projection rules хранятся в calculation registry с source/test traceability.

## 11.3. KPI documentation contract

Каждая управленческая KPI должна иметь:

```text
name
→ business meaning
→ units
→ source entities
→ formula/function
→ status filters
→ null/empty behavior
→ rounding
→ time boundary
→ reconciliation
→ test
```

UI label без чтения implementation не является доказательством формулы.

---

# 12. Error, loading, empty and stale states

Critical surfaces должны различать:

- loading;
- empty;
- error;
- retry where safe;
- stale/offline where applicable;
- success/confirmed;
- provider pending/rejected/terminal.

API/mobile error classes минимум:

- validation;
- authorization;
- not found;
- conflict;
- dependency unavailable;
- provider pending;
- provider rejected;
- retryable technical failure;
- terminal business failure.

Raw stack trace, secrets и provider diagnostics запрещены в user UI.

---

# 13. Security and access-control boundaries

Fail-closed boundaries:

- OTP/session lifecycle;
- project/object ACL;
- customer/contractor/team/viewer/technical supervisor/admin/operator roles;
- horizontal IDOR/cross-project access;
- admin endpoints;
- WebSocket subscriptions;
- documents/media/S3;
- finance/payments/refunds/webhooks;
- provider callbacks;
- account deletion/anonymization/purge.

Secrets/tokens/payment credentials/sensitive document contents не логируются plaintext.

Local runtime дополнительно запрещает remote Docker и staging/production credentials.

---

# 14. Tests and verification matrix

## 14.1. Local developer/agent gates

- `doctor` — prerequisites + local safety boundary;
- `bootstrap` — exact locked dependencies;
- `check` — PostgreSQL/Redis/MinIO/API health/readiness/Alembic/worker heartbeats;
- `seed` — explicit development-only demo materialization;
- `test-focused` — fast local contract gate;
- `test-full` — focused-first + full backend pytest + mobile typecheck/contracts.

## 14.2. Root test surfaces

- `mobile:test`;
- `e2e:playwright` / `e2e:web`;
- `e2e:api`;
- `e2e:portal-ui`;
- `e2e:contract-gate-ui`;
- `e2e:ci`;
- `verify`;
- `test:offline`;
- `test:routes`;
- `test:guards`;
- `test:priority`;
- `typecheck:mobile`;
- staging/readiness workflows.

## 14.3. Canonical local E2E proof

Required sequence:

1. exact Node/Python/Poetry;
2. materialize `.env.local`;
3. negative safety tests;
4. locked bootstrap without lock mutation;
5. source + Compose contract;
6. full backend topology start without Expo;
7. runtime truth check;
8. explicit seed;
9. explicit seed **повторно**;
10. runtime truth re-check;
11. focused local contracts;
12. diagnostics on failure;
13. cleanup.

Double seed проверяет и idempotence, и реальную возможность записывать `task/payment` messages в PostgreSQL.

## 14.4. PostgreSQL schema verification

Required chain:

```text
single Alembic head
→ reject empty/stale DB where required
→ clean upgrade to current head
→ reflected migration invariants
→ complete ORM table/column/native-enum parity
→ accept current head
→ downgrade new migrations
→ verify removal/reject stale DB
→ replay current migrations
→ reflected + generic parity
→ accept current head
```

Generic parity verifier нельзя ослаблять ради green CI.

## 14.5. Evidence history

### `d88af75bbdb1d594f10145be37d53347c02e60a1`

**HISTORICAL CI VERIFIED:** 26/27 workflows success. Единственный failure — Canonical local runtime; он выявил chat enum drift и destructive startup seed.

### `df759e37f9afdf1f983c2c770acf5c66865bae9e`

**HISTORICAL red-team evidence:**

- clean upgrade through w17 — success;
- reflected current migration verifier — success;
- generic ORM/native-enum parity — failure с ровно тремя remaining mismatch: NotificationType, JobLead.status, PaymentStatus order.

Это evidence стало основанием `w18nativeenumparity01`.

### Current candidate после w18

**PENDING REVERIFY.** Final verdict строится только по exact final SHA после синхронизации ТЗ/drift gates и полного CI.

---

# 15. Независимые критические PR-контуры

- **#282** — chat atomicity/idempotency/concurrency;
- **#283** — production observability;
- **#284** — backup/restore/DR;
- **#287** — warranty implementation;
- **#286** — canonical local runtime + coding-agent onboarding + schema/documentation truth.

Schema enum parity принадлежит #286. Transaction/delivery atomicity остаётся #282.

#284 имеет controlled compatibility overlap с #286 только там, где restore workflow обязан проверять current schema head; функциональная DR ownership остаётся #284.

---

# 16. Known gaps / improvement backlog

Полный управляемый roadmap: `docs/technical-spec/CHANGELOG-ROADMAP.md`.

## P0 — до признания #286 merge-ready

1. **PENDING:** clean PostgreSQL upgrade/downgrade/replay через `w18nativeenumparity01`.
2. **PENDING:** generic ORM/native-enum parity = zero mismatch.
3. **PENDING:** canonical local `start → check → seed → seed → check → focused`.
4. **PENDING:** общий CI/security exact final SHA.
5. **PENDING:** technical-spec drift gates exact final SHA.
6. **PENDING:** после schema-owner merge rebase #284 и повторный DR proof against current head.

## External P0/P1 evidence

Branch protection/ruleset, реальные provider credentials, production backup/PITR, alert delivery, store delivery и production RPO/RTO не считаются доказанными по repo code.

## P1 — product/documentation completeness

1. Довести `SCREEN-CONTRACT-CATALOG.md` до всех canonical secondary/deeplink screens: Home, Chat, Calendar, Documents, Inbox, Approvals, Reports, Manager Dashboard, Stage detail, remaining Budget/Object/Repair subscreens.
2. Построить API endpoint catalog из clean FastAPI/OpenAPI: method/path/schema/auth/idempotency/error classes.
3. Довести `CALCULATION-REGISTRY.md` до всех управленческих KPI.
4. Добавить visual regression canonical hubs после стабилизации UI.
5. UI consistency: local `StyleSheet/Pressable/chip/status` deviations → shared components/tokens либо explicit exception.
6. Унифицировать loading/empty/error/retry/stale/offline patterns critical screens.

## P2 — architecture/maintainability

- machine-readable coverage matrix `route/API/entity/calculation/screen → source → test → doc → evidence`;
- schema-change checklist для любого ORM Enum/Column/constraint;
- automated UI semantic component/token drift;
- продолжать удалять duplicate legacy routes после canonical replacements;
- не создавать role-forked duplicate screens;
- не объявлять staging/provider/backup/alert/store behavior VERIFIED без retained external evidence.

---

# 17. Traceability matrix

| Product concern | Source of truth | Verification |
|---|---|---|
| engineering policy | `AGENTS.md` | source contract/PR review |
| local runtime | `scripts/dev-runtime.sh`, Compose, env local | local-runtime CI |
| startup/seed lifecycle | `main.py`, `app.dev_seed`, `seed_demo.py` | source contract + double-seed local CI |
| DB schema/head | Alembic | clean PostgreSQL lifecycle |
| ORM tables/columns/enums | `entities.py` | generic ORM/native-enum parity |
| migration-owned enum contract | w16/w17/w18 + current verifier | reflected current-schema verifier |
| API composition | `api/v1/router.py` | API tests/OpenAPI/E2E |
| mobile IA | `routeRegistry.ts` | route/mobile contracts |
| role shell | shared Os screens + wrappers | mobile contracts/E2E |
| design tokens | Theme/typography/uiTokens/screenLayout | static/UI contracts |
| hub tabs | `OsHubTabs` + hub screens | mobile contracts/E2E |
| finance | entities/services/domain functions | finance tests/PostgreSQL concurrency where required |
| payment state machine | `PaymentStatus` + payment service | explicit transition tests + PG enum parity |
| chat persisted types | `ChatMessageType` + w17 | generic parity + double seed |
| chat transaction/delivery | chat service/API/mobile | #282 tests/E2E/load |
| notifications | `NotificationType` + w18 | generic parity + notification tests |
| job leads | `JobLeadStatus` + w18 | generic parity + lead tests |
| observability | logging/probes/runbook | #283 + external evidence |
| DR | restore scripts/runbook/workflow | #284 drill evidence |
| warranty | warranty service/API/mobile | #287 workflow/tests |
| change history/roadmap | `CHANGELOG-ROADMAP.md` | spec review + drift contract |
| release/readiness | readiness docs/evidence | exact artifact workflows + external proof |

---

# 18. Documentation Definition of Done

Изменение Renova документировано только если:

- behavior имеет канонический owner/source;
- route/API/entity/state/enum/financial meaning не дублируется противоречиво;
- schema change имеет migration + current verifier/generic parity + ТЗ;
- UI measurement взят из shared token/component либо exception объяснён;
- critical flow имеет loading/error/success/fail-closed semantics;
- evidence status назван честно;
- known gap не замаскирован optimistic wording;
- tracked source snapshot обновлён;
- `CHANGELOG-ROADMAP.md` содержит причину, решение, verification, residual risk и следующий шаг;
- final status опирается на exact final SHA.

---

# 19. Change log master dossier

## 2026-08-28 — v1

- создан единый living technical/product dossier;
- зафиксированы runtime, domain graph, API groups, IA, role-sharing principle;
- зафиксированы Object/Repair/Budget hub contracts и exact UI tokens;
- добавлен machine-enforced documentation drift gate.

## 2026-08-28 — v2

- canonical local runtime выявил legacy status storage drift;
- добавлен `w16legacystatus01`;
- следующий full startup выявил `chatmessagetype` drift и destructive demo seed;
- добавлен `w17chatmessageenum01`;
- startup отделён от explicit seed;
- demo seed стал preserve-by-default;
- generic ORM/native-enum verifier начал проверять type name + ordered labels;
- local workflow получил double-seed proof;
- создан governed `CHANGELOG-ROADMAP.md`.

## 2026-08-28 — v3

- generic verifier на clean PostgreSQL после w17 выявил полный остаточный список из трёх mismatch;
- migration history Notification/JobLead/Payment проверена по реальным Alembic sources;
- `PaymentStatus` state machine подтверждена как explicit transitions без ordinal comparison;
- добавлен `w18nativeenumparity01` для NotificationType, JobLeadStatus и PaymentStatus order;
- current verifier расширен до семи migration-owned enum invariants;
- master schema head повышен до `w18nativeenumparity01`;
- статус оставлен **PENDING REVERIFY** до exact-head lifecycle + local runtime + spec gates.
