# Renova — живое техническое задание и системная спецификация

**Статус документа:** ACTIVE / LIVING SPECIFICATION  
**Язык:** русский  
**Дата базовой ревизии:** 2026-08-28  
**Ветка базовой проверки:** `fix/canonical-local-runtime-agents`  
**Текущий schema head в этой редакции:** `w17chatmessageenum01`  
**Назначение:** единый технический паспорт продукта, архитектуры, данных, экранов, процессов, интерфейсов, тестов, evidence и известных разрывов Renova.

> Этот файл не заменяет `AGENTS.md`. `AGENTS.md` остаётся единственным authoritative набором engineering-policy для Cursor, Claude Code и других coding agents. Этот документ — authoritative product/system dossier: он объясняет **что существует, как связано, как должно вести себя и чем проверяется**. При конфликте engineering-policy приоритет имеет `AGENTS.md`; при конфликте описания продукта с текущим кодом/миграцией/route registry/CI факт должен быть перепроверен, а этот документ обновлён.

Детальный журнал изменений и рабочий приоритизированный roadmap: `docs/technical-spec/CHANGELOG-ROADMAP.md`. Calculation/screen детализация хранится в остальных annexes `docs/technical-spec/` и не имеет права вводить альтернативную архитектуру.

---

## 0. Правила доказанности и сопровождения

Каждый значимый пункт спецификации имеет один из статусов:

- **VERIFIED** — подтверждён текущим кодом, конфигурацией или миграцией;
- **CI VERIFIED** — подтверждён успешным CI для конкретного SHA;
- **LOCAL TESTED** — подтверждён canonical local runtime, но не внешней средой;
- **STAGING VERIFIED** — подтверждён retained evidence реального staging;
- **PRODUCTION VERIFIED** — подтверждён retained evidence production;
- **PENDING REVERIFY** — код изменён после последнего успешного доказательства и должен быть перепроверен;
- **TBD / UNVERIFIED** — точное поведение/размер/внешняя интеграция не доказаны; запрещено превращать это в «факт» по памяти;
- **HISTORICAL** — историческое решение, не являющееся текущим каноном.

### 0.1. Обязательное правило обновления

Изменение любого из следующих классов требует проверки и, при изменении фактического поведения, обновления ТЗ в том же PR/рабочем контуре:

1. route registry, tab layout, deeplink/redirect;
2. API route, response/error/idempotency contract;
3. ORM entity, Alembic schema, enum/status/state machine;
4. financial recognition/calculation;
5. role/ACL/security boundary;
6. shared UI token/component;
7. hub/subtab/filter/action structure;
8. local/staging/production runtime topology;
9. health/readiness/worker/outbox/provider flow;
10. E2E/user journey or release/readiness gate;
11. demo/local data lifecycle, seed/reset/bootstrap semantics;
12. technical-spec traceability/drift contracts.

### 0.2. Рабочий цикл развития проекта

```text
прочитать master dossier + CHANGELOG-ROADMAP + relevant annex
→ проверить current code / migrations / CI / external evidence
→ выбрать верхний незакрытый P0/P1
→ реализовать bounded change
→ одновременно обновить ТЗ/annex
→ добавить/усилить automated proof
→ получить exact-head validation
→ записать evidence/status/residual risk
→ перейти к следующему пункту
```

Запрещено наращивать cosmetic backlog при существующем доказанном P0 correctness/data-loss/runtime blocker.

### 0.3. Проверенный source snapshot

Blob SHA предназначены для traceability, а не как замена истории Git.

| Source | Blob SHA | Что подтверждает |
|---|---|---|
| `AGENTS.md` | `77cfc7850138c9a0f33739c9147ba6fc3e0eb183` | engineering/runtime/security/DoD canon |
| `backend/app/api/v1/router.py` | `fe0e66377eb57ba968e91370267a8f5cf812a3fa` | API composition/canonical route replacement |
| `backend/app/models/entities.py` | `f2e63f316fa8c9b2012894ae4e496dc76a73a3a1` | ORM/domain entities/status/enum mappings |
| `backend/app/main.py` | `223e83b13f96398eefe997275ac6f41fa44bfbcf` | API lifespan; startup не запускает demo business-data seed |
| `backend/app/services/seed_demo.py` | `c62ba920130a7ba7f6e2bd0a54e63feadce5c6cd` | explicit demo seed; canonical-demo-only chat dedupe |
| `backend/scripts/verify_orm_schema_parity.py` | `ba08d0681df301f446b3adbf811ad9367eeb24b9` | ORM ↔ PostgreSQL table/column/native-enum parity |
| `backend/scripts/verify_current_migration_schema.py` | `3f216cebd604337a539d67056bad8247000527cc` | current migration-owned reflected enum invariants |
| `apps/mobile/lib/routeRegistry.ts` | `0c9a386486f61cd1a284d8bd7fc99368b557232f` | mobile IA/routes/audience/visibility/redirects |
| `apps/mobile/constants/Theme.ts` | `6e66c4bf0db8c9d1b8c4a2d0355311145ca43b20` | colors/spacing/radius/font sizes/touch target/card baseline |
| `apps/mobile/constants/typography.ts` | `8a96b7f290944ac2c566c0f1791c1f60ab90c68a` | semantic typography |
| `apps/mobile/constants/screenTypography.ts` | `f91c9a659a1ab8603ae4d82eb46d76754627b5bb` | hub/list/filter typography and geometry |
| `apps/mobile/constants/uiTokens.ts` | `ca2d8e9e03f56efb058041ad8a81c04d15c7a8a0` | chips/surfaces/input field |
| `apps/mobile/constants/screenLayout.ts` | `0165f3c86d829311e91ac17b875c23ccaefab12b` | screen padding |
| `apps/mobile/components/renova/os/OsHubTabs.tsx` | `f480067b06c750623e4091fe0db128c877e3fb37` | hub tab progressive disclosure/geometry |
| `apps/mobile/components/screens/OsObjectHubScreen.tsx` | `3082b1bf59cbf420d403ed82b35bbc2e78697728` | Object hub composition |
| `apps/mobile/components/screens/OsRepairHubScreen.tsx` | `5fe0e6229ad4cc82462ea4cfc1f7d213c7687305` | Repair hub composition/badges/deeplinks |
| `apps/mobile/components/screens/OsBudgetHubScreen.tsx` | `4e0e8267d68b600cf0d8bdf716a4c8eddaa3bcbd` | Budget hub composition |
| `apps/mobile/constants/budgetTabs.ts` | `d02c05560176535e130d76960c2b67691bcbb3b7` | Budget tabs/legacy normalization |
| `.cursor/rules/renova-design-system.mdc` | `2f48e46f5b348b8cbc3a370615a5a5e93d93421f` | mobile UI rules |
| `package.json` | `4c95fcf89d7e29f1c464a7db2c7aa4c85335fe11` | root scripts/test entry points |
| `.github/workflows/local-runtime-integrity.yml` | `3ae00fa13be960bf7acba71c8cfa41134d35e16f` | canonical local start/check/double-seed/focused proof chain |
| `backend/alembic/versions/w16legacystatus01_legacy_status_enum_parity.py` | `d2137f2b87c1ac6f679093331bd034aff17c8188` | legacy VARCHAR status → native enum repair |
| `backend/alembic/versions/w17chatmessageenum01_chat_message_enum_parity.py` | `0537268c85e26b7a607d36f967a3402b8bba53c4` | chat message PG enum labels → current ORM contract |
| `docs/technical-spec/CHANGELOG-ROADMAP.md` | `e8062a7f822c9687ad4adc385f05ae0afcf9962f` | governed change history and prioritized roadmap |

---

# 1. Назначение продукта и границы системы

**VERIFIED.** Renova — production-oriented платформа управления ремонтом для заказчика и исполнителя. Архитектура строится вокруг общего `Project` и связанных операционных контуров, а не набора независимых mini-app экранов.

Основные пользовательские роли, подтверждённые текущим кодом/engineering canon:

- customer / заказчик;
- contractor / исполнитель;
- team/viewer участники;
- technical supervisor / технический надзор;
- admin/operator для ограниченных административных и восстановительных операций.

Точная матрица разрешений выводится из API guards и role-aware mobile paths. Наличие роли в продукте **не означает**, что любой route доступен этой роли.

## 1.1. Главные продуктовые области

Текущий mobile IA канон:

`Главная → Объект → Ремонт → Бюджет/Деньги → Сообщения`, при этом `Сроки` — отдельный календарный hub, доступный как optional/secondary entry point.

Вторичные функции не должны становиться дублями верхнего уровня. Документы, согласования, входящие, отчёты, приёмка, закупки, подборы и аналитика входят через канонические hubs/redirects.

---

# 2. Репозиторий и источники истины

## 2.1. Engineering policy

**VERIFIED:** `AGENTS.md`.

`CLAUDE.md` и глобальные Cursor agent rules — bootstrap/pointer к `AGENTS.md`, без второго самостоятельного набора branch/runtime/readiness правил.

## 2.2. Product/navigation truth

**VERIFIED:** `apps/mobile/lib/routeRegistry.ts` плюс текущая Expo Router implementation.

## 2.3. API truth

**VERIFIED:** `backend/app/api/v1/router.py` плюс конкретные routers/services.

При миграции legacy handler → canonical handler старый route удаляется из router composition через `_remove_replaced_routes(...)`, чтобы порядок imports не создавал shadow route.

## 2.4. Database truth

**VERIFIED:** ORM models + линейный Alembic graph. PostgreSQL — authoritative durable store для staging/production. SQLite не является доказательством production semantics, PostgreSQL native enums, locking или concurrency.

Current revision в этой редакции: `w17chatmessageenum01`.

## 2.5. Readiness truth

`PRODUCTION-READINESS.md` и `docs/production-readiness-evidence.json` являются readiness sources. Этот документ описывает систему, но **не объявляет** broad production readiness без retained evidence.

---

# 3. Runtime architecture

## 3.1. Процессы

**VERIFIED.** Backend собирается как один immutable image, который запускается минимум в двух ролях:

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
  (only through explicit boundaries)
```

- `renova-api`: FastAPI HTTP/WebSocket, auth/ACL, synchronous request handling, API-local Redis bridge/heartbeat.
- `renova-worker`: durable background execution, Domain Outbox, provider reconciliation, optional reminders, push receipt reconciliation, worker heartbeat.
- PostgreSQL: authoritative application state.
- Redis: shared runtime coordination/rate limits/topology/WebSocket coordination where explicitly configured.
- S3-compatible storage: documents/media.

**Constraint:** durable business jobs нельзя возвращать в API startup/background tasks; API replica должна быть disposable без потери pending work.

## 3.2. Canonical local topology

**VERIFIED source:**

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

`reset` — destructive только для isolated local project/volumes.

## 3.3. Local safety boundary

**VERIFIED source contract:** canonical local tooling обязано отказывать при:

- remote `DOCKER_HOST` (`tcp://`, `ssh://` и аналогичные remote endpoints);
- remote Docker context;
- `ENVIRONMENT=staging`/`production`;
- непустых external provider credentials/sinks в canonical local profile.

Compose дополнительно зануляет внешние provider/sink переменные, чтобы direct local Compose startup не подтянул staging/production secrets.

## 3.4. Startup sequence

Canonical fail-fast sequence:

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
→ local worker heartbeat
→ shared Redis worker heartbeat
→ optional Expo
```

Migration failure не допускается скрывать `|| true` или best-effort логикой.

## 3.5. Startup ≠ seed

**VERIFIED source / PENDING REVERIFY runtime.** API lifespan не должен создавать, удалять или переписывать demo business data.

Canonical lifecycle:

```text
npm run dev
= start runtime only

npm run dev -- seed
= explicit development-only, Alembic-head-gated demo materialization
```

Причина правила: API restart должен быть безопасным и детерминированным. Restart/redeploy не является business-data migration или demo-data reset operation.

Explicit seed может запускаться только при `ENVIRONMENT=development`, разрешённом demo seed policy и database revision = bundled Alembic head.

## 3.6. Explicit seed invariants

`seed_demo.py` обязан быть additive/idempotent:

- не удаляет произвольные project chats;
- не удаляет `work:<id>` domain threads;
- не удаляет e2e/local developer threads только потому, что title неизвестен seed;
- может дедуплицировать только собственные canonical demo-title;
- повторный seed должен сохранять runtime healthy;
- current CI chain вызывает seed **дважды** подряд.

---

# 4. Data/domain model — системная карта

Ниже — domain-level карта. Column-level truth остаётся в ORM + Alembic.

## 4.1. Core project graph

```text
User
 ├─ owns/participates in → Project
 │   ├─ Rooms / Property floors / Property object
 │   ├─ Stages / Work orders / Work schedules
 │   ├─ Estimate lines / Budget lines
 │   ├─ Material picks → Purchases → Purchase items
 │   ├─ Selection items
 │   ├─ Expenses / Payments / Receipts / Change orders
 │   ├─ Work acceptances / Issues / Rework
 │   ├─ Chat threads → Chat messages / participants / reads
 │   ├─ Documents → OCR / e-sign / lifecycle
 │   ├─ Floor plans / pins
 │   ├─ Notifications / Activity / Audit
 │   └─ Reports / analytics / KPI history
 └─ auth/session/team/subscription/account lifecycle
```

## 4.2. Financial semantic separation

**VERIFIED engineering canon:**

- Estimate — план стоимости/scope;
- Commitment — подтверждённое обязательство;
- Purchase — procurement/acquisition event;
- Expense — признанный расход проекта;
- Payment — движение денег/payment state;
- Receipt — первичный/подтверждающий документ, не автоматически ещё один expense;
- Refund — обратное движение денег/economic correction;
- Change Order — согласованное изменение scope/budget.

Запрещено использовать эвристику `max(receipt, expense, estimate_fact)` как универсальную дедупликацию.

## 4.3. Legacy status enum parity repair — `w16legacystatus01`

**CI VERIFIED на предшествующем exact SHA; PENDING REVERIFY после w17.** Canonical PostgreSQL runtime выявил три legacy status columns, созданные как `VARCHAR`, при current ORM native enum mapping.

| Table | ORM/PG enum | Allowed values | Previous storage |
|---|---|---|---|
| `purchases.status` | `purchasestatus` | draft, approved, ordered, paid, partial, delivered, cancelled, returned | `VARCHAR(32)` |
| `material_picks.status` | `materialpickstatus` | draft, pending, approved, purchased | `VARCHAR(32)` |
| `selection_items.status` | `selectionstatus` | draft, proposed, approved, rejected | `VARCHAR(16)` |

Migration валидирует существующие значения до cast; unknown value останавливает upgrade. Downgrade возвращает исходные VARCHAR lengths.

Это не повод превращать все String-status в PG enum. Storage contract определяется конкретной migration history + ORM mapping.

## 4.4. Chat message enum parity repair — `w17chatmessageenum01`

**PENDING REVERIFY.** Full canonical local startup после `w16` обнаружил второй enum drift:

- v14 PostgreSQL `chatmessagetype`: `text, photo, confirm, system`;
- current ORM/mobile: `text, photo, file, confirm, system, task, invoice, payment`.

Desired PG contract:

```text
chat_messages.message_type
→ native ENUM chatmessagetype
→ text | photo | file | confirm | system | task | invoice | payment
```

`w17chatmessageenum01` допускает только точное legacy или exact current состояние. Неизвестный промежуточный label set fail-closed.

Downgrade разрешён только если ни одна строка не использует `file/task/invoice/payment`; silent truncation/coercion запрещены.

## 4.5. General native-enum parity invariant

`verify_orm_schema_parity.py` обязан для каждой mapped `SQLAlchemy Enum(native_enum=True)` проверить:

1. migrated column существует;
2. PostgreSQL storage действительно native `ENUM`;
3. PG enum type name совпадает с ORM type name;
4. ordered PG labels полностью совпадают с ORM `enums`.

Это дополняет table/column parity и не позволяет model-only enum change оставаться невидимым до runtime write.

---

# 5. Transaction, idempotency, outbox и provider boundary

## 5.1. Critical mutation rule

Одна business operation должна по возможности иметь одну DB transaction boundary:

```text
authoritative mutation
+ audit/activity
+ DomainOutbox enqueue
= one committed operation
```

Concurrency-sensitive деньги, acceptance, permissions, scope, provider state требуют DB constraints + locking/fencing/version rule там, где это необходимо.

## 5.2. Durable side effects

Canonical pattern:

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

Production observability развивается отдельно в **PR #283** и не должна хаотично смешиваться с local-runtime hardening.

---

# 6. API composition

Все API ниже живут под `/api/v1`.

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
- stage mutations, review transitions, stage extensions;
- project checklists / checklist templates / reactions;
- technical supervision and actions.

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
- projects reader/legacy compatible routes;
- rooms/room requests;
- calendar integrity/mutations/calendar;
- chat inbox;
- chats;
- technical supervision chat.

Chat atomicity/idempotency/concurrency hardening развивается отдельно в **PR #282**. Schema value parity `chatmessagetype` относится к database truth и исправляется в #286 через `w17`.

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

**VERIFIED.** Customer и contractor route groups — тонкие role-aware wrappers над общими `Os*Screen`, а не два независимых продукта. Это важный anti-drift принцип.

Пример customer:

```text
(customer)/(tabs)/index.tsx  → OsHomeScreen role="customer"
(customer)/(tabs)/object.tsx → OsObjectHubScreen role="customer"
(customer)/(tabs)/repair.tsx → OsRepairHubScreen role="customer"
(customer)/(tabs)/budget.tsx → OsBudgetHubScreen role="customer"
```

Contractor использует тот же family shared screens с `role="contractor"`.

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

**VERIFIED source:** `OsObjectHubScreen.tsx`.

Tabs:

1. `rooms` — **Комнаты**, primary, default;
2. `estimate` — **Смета**, primary;
3. `plan` — **План**, secondary за progressive disclosure;
4. `profile` — **Данные**, secondary.

Subscreens: `OsRoomsScreen`, `OsEstimateScreen`, `OsPlanTabScreen`, `OsProjectProfileScreen`.

Shared callback `onNextTab/goTab` связывает последовательный flow между subsections без нового top-level route.

## 8.2. Repair hub

**VERIFIED source:** `OsRepairHubScreen.tsx`.

Tabs:

1. `works` — **Этапы**, primary/default;
2. `control` — **Приёмка**, primary; badge = pending acceptance count;
3. `materials` — **Материалы**, secondary;
4. `selections` — **Подбор**, badge = pending selections; secondary при badge=0.

Subscreens: `OsWorksScreen`, `OsControlScreen`, `OsMaterialsScreen`, `OsSelectionsScreen`.

Deep-link behavior:

- legacy `tab=calendar` → canonical Calendar hub;
- `subtab=picks|purchases|receipts` → Materials;
- `tab=selections` → Selections.

Pending badge errors fail to zero и проходят через `reportError`, а не отображаются ложным positive state.

## 8.3. Budget hub

**VERIFIED sources:** `OsBudgetHubScreen.tsx`, `budgetTabs.ts`.

Canonical tabs:

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

**VERIFIED entrypoint:** shared `OsHomeScreen(role)` через role-aware wrappers. Точный component-level inventory расширяется в `SCREEN-CONTRACT-CATALOG.md`; здесь не фиксируются непроверенные локальные размеры.

Canonical Home — orchestration/attention surface, а не копия secondary centers.

## 8.5. Chat

**VERIFIED route:** обязательный dock area для обеих ролей.

Current message types на ORM/mobile contract:

```text
text | photo | file | confirm | system | task | invoice | payment
```

PostgreSQL parity этого набора принадлежит `w17chatmessageenum01`. Message atomicity/idempotency, thread ACL и delivery consistency развиваются/проверяются отдельно в PR #282.

---

# 9. UI design system — точные токены

## 9.1. Цвета

**VERIFIED `Theme.ts`:**

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

Локальные hex в operational screen components запрещены design-system rule; используются tokens/UI primitives.

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

Hub/screen semantics:

- screen hero = h1 22 / bold;
- sheet title = h2 18 / bold;
- sheet value = hero 24 / bold;
- section = bodySmall 13 / semibold; marginTop 12, marginBottom 6;
- list title = 15 / semibold;
- list meta = caption 12 / regular / lineHeight 16;
- metric = 20 / bold;
- body lineHeight 20;
- bodySmall lineHeight 18;
- caption lineHeight 16;
- tiny lineHeight 14.

## 9.5. Touch/input

Minimum touch target: **44 px**.

Input field:

- minHeight 44;
- radius 10;
- border 1;
- horizontal padding 12;
- font size 14;
- surface background.

## 9.6. Filter chips

- row flex-wrap, gap `6`;
- chip horizontal padding `10`;
- vertical padding `6`;
- radius `14`;
- border `1`;
- inactive = surface + border;
- active = infoBg + primary border;
- label = caption 12 / semibold;
- active label = primary.

## 9.7. Hub tabs

`OsHubTabs` uses underline tabs, **не pill-card tabs**:

- container: bottom hairline border, surface;
- row horizontal padding `8`, top `4`, gap `4`;
- tab horizontal padding `12`, vertical `10`;
- active underline `2` primary;
- label `14/500`, active `14/700`;
- badge minWidth/height `16`, radius `8`, paddingHorizontal `4`;
- badge text `9/800`;
- badge > 9 renders `9+`;
- secondary tabs скрываются за `Все`, пока не раскрыты или current value не secondary.

## 9.8. UI constraints

- максимум 1 primary CTA на экран;
- максимум 4 hub tabs без progressive disclosure/«Ещё»;
- statuses только через `StatusPill` semantic tones;
- emoji не используются как operational icons; используются `Ionicons`;
- user UI не показывает runtime/dev strings;
- primary/outline/danger semantics не смешиваются;
- customer FAB: Расход · Сообщение · Замечание · Фото; «Черновик» не quick action.

Известный consistency debt: часть Technical Supervision control actions использует local `Pressable` styling вместо shared `PrimaryButton`; исправлять следует отдельным UI-consistency проходом с сохранением CTA semantics.

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

Точные required fields/validations берутся из project creation schemas/services.

## 10.2. Execution/acceptance

```text
Stage planned
→ start / dates / rooms / work type / dependencies
→ execution
→ submit/review
→ acceptance decision
→ done/rework/reject according to state rules
```

Control/acceptance UI входит через `Ремонт → Приёмка`, а не отдельный permanent top-level hub.

## 10.3. Work order → chat relation

**VERIFIED:** `create_work_order()` создаёт отдельный thread `work:<work_order_id>` и сохраняет его в `work_orders.chat_thread_id`.

Следствие:

- этот thread является domain-owned resource;
- demo seed/reset отдельных UI demo-сущностей не имеет права удалять его без удаления/переноса владельца по явной бизнес-операции;
- generic project-chat purge запрещён.

## 10.4. Materials/procurement

```text
material need / MaterialPick
→ approval/readiness
→ Purchase
→ PurchaseItem
→ ordered/paid/partial/delivered/returned/cancelled
→ receipt/evidence
→ expense/payment recognition according to finance semantics
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

UI entrypoint: `Ремонт → Подбор`; pending count может поднимать вкладку из secondary disclosure.

## 10.6. Payments

```text
business obligation
→ payment record/state
→ checkout/provider or documented manual flow
→ pending/processing/unverified/confirmed/etc.
→ provider/bank reconciliation
→ financial recognition rules
```

Provider timeout или local UI success не являются окончательным подтверждением денег.

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

Task/payment messages являются persisted chat message types и требуют PostgreSQL enum parity; atomicity/idempotency status отражается #282.

## 10.9. Warranty

Warranty — отдельный bounded contour в **PR #287**. Canonical IA entry сейчас Document Center/deeplink `warranty-claim`; implementation не смешивается с local runtime PR #286.

---

# 11. Calculations and derived state

Детальный реестр: `docs/technical-spec/CALCULATION-REGISTRY.md`.

## 11.1. Currency formatting

**VERIFIED:** `formatRub(amount)` использует `Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 })`.

## 11.2. Budget/financial calculations

Обязательные semantics:

- отсутствие двойного признания одной economic operation;
- явное отношение estimate/commitment/purchase/expense/payment/receipt/refund/change order;
- явная обработка pending/cancel/refund/dispute;
- partial/overpayment где применимо;
- reconciliation с bank/provider evidence.

Подтверждённые формулы и projection rules не дублируются здесь полностью; они поддерживаются в `CALCULATION-REGISTRY.md` с source/test traceability.

## 11.3. Project progress / schedule calculations

Точные formula/source/tests поддерживаются в calculation registry. Наличие UI label или тестового имени без чтения implementation не считается достаточным основанием для формулы.

## 11.4. Coverage rule

Каждая управленческая KPI должна в итоге иметь:

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

---

# 12. Error, loading, empty and stale states

Обязательный product contract для critical surfaces:

- loading;
- empty;
- error;
- retry where safe;
- stale/offline where applicable;
- success/confirmed;
- provider pending/rejected/terminal distinctions.

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

Raw stack trace/provider secret/runtime diagnostics запрещены в user UI.

---

# 13. Security and access-control boundaries

Fail-closed boundaries:

- OTP/session lifecycle;
- project/object ACL;
- roles customer/contractor/team/viewer/technical supervisor/admin/operator;
- horizontal IDOR/cross-project access;
- admin endpoints;
- WebSocket subscriptions;
- documents/media/S3;
- finance/payments/refunds/webhooks;
- provider callbacks;
- account deletion/anonymization/purge.

Secrets/tokens/payment credentials/sensitive document contents не логируются в plaintext.

Local safety дополнительно требует запрета remote Docker/staging/production secrets в canonical local runtime.

---

# 14. Tests and verification matrix

## 14.1. Local developer/agent gates

- `doctor` — prerequisites + local safety boundary;
- `bootstrap` — exact locked dependency installation;
- `check` — PostgreSQL/Redis/MinIO/API health+ready/Alembic head/worker heartbeat;
- `seed` — explicit development-only demo materialization;
- `test-focused` — fast local contract gate;
- `test-full` — focused first, затем full backend pytest + mobile typecheck + mobile contracts.

## 14.2. Root test surfaces

Подтверждены:

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
- staging/readiness scripts.

## 14.3. Canonical local runtime workflow

Current required sequence:

1. exact Node/Python/Poetry setup;
2. materialize `.env.local`;
3. negative local safety tests;
4. locked bootstrap + no lock mutation;
5. source + Compose contract;
6. full backend topology start without Expo;
7. runtime truth check;
8. explicit demo seed;
9. explicit demo seed **повторно**;
10. runtime truth re-check;
11. focused local contracts;
12. diagnostics on failure;
13. cleanup.

Этот workflow является основным E2E proof для local developer/agent startup, но не заменяет staging/production evidence.

## 14.4. PostgreSQL schema verification

Обязательная связка:

```text
single Alembic head
→ clean PostgreSQL upgrade
→ reflected migration invariants
→ complete ORM table/column/native-enum parity
→ head acceptance
→ downgrade/replay tests где семантически допустимо
```

Нельзя ослаблять parity verifier, чтобы сделать CI зелёным. Новый mismatch должен приводить к migration/contract repair либо документированному корректному storage exception.

## 14.5. Current evidence status

### Предыдущий exact candidate `d88af75bbdb1d594f10145be37d53347c02e60a1`

**CI VERIFIED historical exact-head facts:** 26 из 27 workflow завершились `success`, включая:

- общий `CI`;
- Database schema integrity;
- Staging runtime integrity;
- Provider operations integrity;
- Database restore integrity;
- Runtime topology integrity;
- Backend image integrity;
- Push receipt reconciliation integrity;
- Production readiness integrity;
- technical specification integrity;
- Security operations integrity;
- CodeQL SAST;
- domain-specific finance/auth/calendar/technical-supervision workflows.

Единственный failure: `Canonical local runtime integrity`.

Failure дал два новых факта:

1. physical `chatmessagetype` отстал от ORM/mobile enum и rejected `task`;
2. startup demo seed мог удалять domain-owned work-order chat и нарушать FK.

### Current candidate после w17/startup/seed changes

**PENDING REVERIFY.** После любого нового commit старые green results не переносятся. Final verdict строится только по workflow runs exact final SHA.

---

# 15. Независимые критические PR-контуры

- **#282 — chat atomicity/idempotency/concurrency**;
- **#283 — production observability**;
- **#284 — backup/restore/DR**;
- **#287 — warranty implementation**;
- **#286 — canonical local runtime + coding-agent onboarding + schema/documentation truth**.

Schema parity `chatmessagetype` принадлежит #286, потому что это migrated storage compatibility. Transaction/message-delivery atomicity остаётся #282.

#284 имеет controlled compatibility overlap с #286 только там, где restore workflow должен проверять current schema head; функциональная DR ownership остаётся #284.

---

# 16. Known gaps / improvement backlog

Полный управляемый roadmap: `docs/technical-spec/CHANGELOG-ROADMAP.md`.

## P0 — до признания #286 merge-ready

1. **PENDING:** exact-head clean PostgreSQL chain через `w17chatmessageenum01`.
2. **PENDING:** enhanced generic ORM/native-enum parity должен либо стать green, либо выявить следующий конкретный mismatch.
3. **PENDING:** canonical local `start → check → seed → seed → check → focused`.
4. **PENDING:** общий CI/security exact final SHA после w17.
5. **PENDING:** technical-spec drift gates exact final SHA.

## P0 external

GitHub `main` branch protection/ruleset — external configuration fact. Нельзя считать его включённым только по repo code; нужен configuration evidence/negative test.

## P1 — product/documentation completeness

1. Довести `SCREEN-CONTRACT-CATALOG.md` до всех canonical secondary/deeplink routes.
2. Сформировать API endpoint catalog из clean FastAPI/OpenAPI runtime: method/path/schema/auth/idempotency/error classes.
3. Довести `CALCULATION-REGISTRY.md` до всех управленческих KPI.
4. Добавить visual regression/screenshots canonical hubs после стабилизации UI.
5. Провести UI consistency pass: local `StyleSheet/Pressable/chip/status` deviations → shared components/tokens или explicit exception.
6. Унифицировать loading/empty/error/retry/stale/offline patterns critical screens.

## P1/P2 — architecture quality

- продолжать удалять duplicate legacy routes после canonical replacements;
- не создавать role-forked screen implementations при наличии shared role-aware screen;
- усиливать source-level traceability `entity → service → API → mobile → E2E → documentation`;
- machine-readable coverage matrix для route/API/entity/calculation/screen;
- любое ORM Enum изменение требует migration/parity/spec update;
- не объявлять staging/provider/backup/alert/store behavior VERIFIED без retained external evidence.

---

# 17. Traceability matrix

| Product concern | Source of truth | Verification |
|---|---|---|
| engineering policy | `AGENTS.md` | source contract/PR review |
| local runtime | `scripts/dev-runtime.sh`, Compose, env local | local-runtime CI |
| local startup data lifecycle | `main.py`, `app.dev_seed`, `seed_demo.py` | source contract + double-seed local-runtime CI |
| DB schema | Alembic | clean PostgreSQL upgrade/head check |
| ORM/domain columns/enums | `entities.py` | ORM/native-enum parity + backend/runtime |
| API composition | `api/v1/router.py` | API tests/OpenAPI/E2E |
| mobile IA | `routeRegistry.ts` | routeRegistry/mobile tests |
| role shell | Expo wrappers + shared Os screens | mobile contracts/E2E |
| design tokens | Theme/typography/uiTokens/screenLayout | UI contract/static review |
| hub tabs | `OsHubTabs` + hub screens | mobile contracts/E2E |
| finance | entities/services/domain calculation functions | finance tests + PostgreSQL concurrency where required |
| chat persisted message types | `ChatMessageType` + Alembic `chatmessagetype` | w17 + generic enum parity + local double-seed |
| chat transaction/delivery | chat service/API/mobile | #282 tests/E2E/load |
| observability | logging/probes/runbook | #283 + external evidence |
| DR | restore scripts/runbook/workflow | #284 drill evidence |
| warranty | warranty service/API/mobile | #287 workflow/tests |
| release/readiness | readiness docs/evidence + exact artifacts | release workflows/external proof |
| change history/roadmap | `CHANGELOG-ROADMAP.md` | spec review + drift contract |

---

# 18. Documentation Definition of Done

Изменение Renova считается документировано только если:

- изменённый behavior имеет канонический owner/source;
- route/API/entity/state/enum/financial meaning не дублируется противоречиво;
- новая/изменённая navigation связь отражена здесь или internal-only объяснена;
- schema change имеет migration + verifier/test + current-head documentation;
- UI measurement берётся из shared token/component либо исключение объяснено;
- critical flow имеет loading/error/success/fail-closed semantics;
- test/evidence уровень назван честно (`VERIFIED`, `CI VERIFIED`, `STAGING VERIFIED`, `PRODUCTION VERIFIED`, `PENDING REVERIFY`);
- known gap не замаскирован optimistic wording;
- source snapshot обновлён при изменении tracked source;
- `CHANGELOG-ROADMAP.md` получает причину, решение, verification и следующий шаг;
- final status опирается на exact final SHA, а не более старый green candidate.

---

# 19. Change log

### 2026-08-28 — living specification v1

- создан единый technical/product dossier;
- зафиксированы runtime, domains, API groups, mobile IA, role-sharing principle;
- зафиксированы Object/Repair/Budget hub contracts;
- зафиксированы точные UI tokens, typography, filter chips, hub-tabs geometry;
- зафиксирован legacy status enum parity defect и repair `w16legacystatus01`;
- отделены #282/#283/#284/#287 от #286;
- сформирован P0/P1 documentation/verification backlog.

### 2026-08-28 — living specification v2 / runtime truth pass

- exact `d88af75...` зафиксирован как 26/27 green; единственный failure — canonical local startup;
- доказан drift `chatmessagetype`: PostgreSQL v14 labels не соответствовали current ORM/mobile;
- добавлен head `w17chatmessageenum01`;
- общий ORM/Alembic verifier расширен до native-enum name + ordered-label parity;
- API lifespan больше не выполняет demo seed;
- formalized invariant `start ≠ seed`;
- demo seed больше не purge'ит произвольные/domain project chats;
- canonical local CI теперь дважды запускает explicit seed;
- создан `docs/technical-spec/CHANGELOG-ROADMAP.md` как обязательный журнал изменений и план развития;
- current state после этих commits честно остаётся **PENDING REVERIFY** до exact-head CI.
