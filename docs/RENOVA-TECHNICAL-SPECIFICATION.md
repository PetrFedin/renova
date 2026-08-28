# Renova — живое техническое задание и системная спецификация

**Статус документа:** ACTIVE / LIVING SPECIFICATION  
**Язык:** русский  
**Дата базовой ревизии:** 2026-08-28  
**Ветка базовой проверки:** `fix/canonical-local-runtime-agents`  
**Назначение:** единый технический паспорт продукта, архитектуры, данных, экранов, процессов, интерфейсов, тестов и известных разрывов Renova.

> Этот файл не заменяет `AGENTS.md`. `AGENTS.md` остаётся единственным authoritative набором engineering-policy для Cursor, Claude Code и других coding agents. Этот документ — authoritative product/system dossier: он объясняет **что существует, как связано, как должно вести себя и чем проверяется**. При конфликте engineering-policy приоритет имеет `AGENTS.md`; при конфликте описания продукта с текущим кодом/миграцией/route registry/CI факт должен быть перепроверен, а этот документ обновлён.

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

Изменение любого из следующих классов требует проверки и, при изменении фактического поведения, обновления этого документа в том же PR:

1. route registry, tab layout, deeplink/redirect;
2. API route, response/error/idempotency contract;
3. ORM entity, Alembic schema, status/state machine;
4. financial recognition/calculation;
5. role/ACL/security boundary;
6. shared UI token/component;
7. hub/subtab/filter/action structure;
8. local/staging/production runtime topology;
9. health/readiness/worker/outbox/provider flow;
10. E2E/user journey or release/readiness gate.

### 0.2. Проверенный source snapshot

Следующие blob SHA фиксируют источники, использованные для этой редакции. Они предназначены для traceability, а не как замена `git` истории.

| Source | Blob SHA | Что подтверждает |
|---|---|---|
| `AGENTS.md` | `77cfc7850138c9a0f33739c9147ba6fc3e0eb183` | engineering/runtime/security/DoD canon |
| `backend/app/api/v1/router.py` | `fe0e66377eb57ba968e91370267a8f5cf812a3fa` | API composition/canonical route replacement |
| `backend/app/models/entities.py` | `f2e63f316fa8c9b2012894ae4e496dc76a73a3a1` | ORM/domain entities/status mappings |
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
| `.github/workflows/local-runtime-integrity.yml` | `101526f496a14104da534f038932a0fb10e52fd0` | canonical local runtime CI proof chain |
| `backend/alembic/versions/w16legacystatus01_legacy_status_enum_parity.py` | `d2137f2b87c1ac6f679093331bd034aff17c8188` | current legacy status enum repair |

---

# 1. Назначение продукта и границы системы

**VERIFIED.** Renova — production-oriented платформа управления ремонтом для заказчика и исполнителя. Текущая архитектура строится вокруг общего `Project` и связанных операционных контуров, а не вокруг набора независимых mini-app экранов.

Основные пользовательские роли, подтверждённые текущим кодом/engineering canon:

- customer / заказчик;
- contractor / исполнитель;
- team/viewer участники;
- technical supervisor / технический надзор;
- admin/operator для ограниченных административных и восстановительных операций.

Точная матрица разрешений должна выводиться из API guards и role-aware mobile paths. Наличие роли в продукте **не означает**, что любой route доступен этой роли.

## 1.1. Главные продуктовые области

Текущий mobile IA канон:

`Главная → Объект → Ремонт → Бюджет/Деньги → Сообщения`, при этом `Сроки` — отдельный календарный hub, доступный как optional/secondary entry point.

Вторичные функции не должны становиться дублями верхнего уровня. Документы, согласования, входящие, отчёты, приёмка, закупки, подборы и аналитика входят через канонические hubs/redirects.

---

# 2. Репозиторий и источники истины

## 2.1. Engineering policy

**VERIFIED:** `AGENTS.md`.

`CLAUDE.md` и глобальные Cursor agent rules должны быть только bootstrap/pointer к `AGENTS.md`, без второго самостоятельного набора branch/runtime/readiness правил.

## 2.2. Product/navigation truth

**VERIFIED:** `apps/mobile/lib/routeRegistry.ts` плюс текущая Expo Router implementation.

## 2.3. API truth

**VERIFIED:** `backend/app/api/v1/router.py` плюс конкретные routers/services.

Особенность текущей архитектуры: при миграции legacy handler → canonical handler старый route удаляется из router composition через `_remove_replaced_routes(...)`, чтобы порядок imports не создавал shadow route.

## 2.4. Database truth

**VERIFIED:** ORM models + линейный Alembic graph. PostgreSQL — authoritative durable store для staging/production. Нельзя считать SQLite доказательством production semantics.

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

**VERIFIED:**

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

**VERIFIED source contract:** canonical local tooling обязан отказывать:

- remote `DOCKER_HOST` (`tcp://`, `ssh://` и аналогичные remote endpoints);
- remote Docker context;
- `ENVIRONMENT=staging`/`production`;
- непустым external provider credentials/sinks в canonical local profile.

Compose дополнительно зануляет внешние provider/sink переменные, чтобы прямой local Compose startup не подтянул staging/production secrets.

## 3.4. Startup sequence

Canonical fail-fast sequence:

```text
local env guard
→ local Docker context guard
→ infra start/health
→ Alembic upgrade head
→ runtime preflight
→ API + worker
→ /health
→ /ready
→ worker heartbeat
→ optional Expo
```

Migration failure не допускается скрывать `|| true` или best-effort логикой.

---

# 4. Data/domain model — системная карта

Ниже — domain-level карта. Column-level truth всегда остаётся в `entities.py` + Alembic.

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

Запрещено использовать эвристику вида `max(receipt, expense, estimate_fact)` как универсальную дедупликацию.

## 4.3. Status enum parity repair — 2026-08-28

**PENDING REVERIFY.** Canonical local runtime выявил реальный PostgreSQL parity defect: legacy migrations создали три status columns как `VARCHAR`, а current ORM связывает их с native PostgreSQL enum.

Repair migration `w16legacystatus01`:

| Table | ORM/PG enum | Allowed values | Previous storage |
|---|---|---|---|
| `purchases.status` | `purchasestatus` | draft, approved, ordered, paid, partial, delivered, cancelled, returned | `VARCHAR(32)` |
| `material_picks.status` | `materialpickstatus` | draft, pending, approved, purchased | `VARCHAR(32)` |
| `selection_items.status` | `selectionstatus` | draft, proposed, approved, rejected | `VARCHAR(16)` |

Migration сначала проверяет все существующие значения и fail-fast прекращает upgrade при неизвестном значении; после этого делает явный PostgreSQL cast. Downgrade возвращает исходные VARCHAR lengths.

**Важно:** это не повод превращать все String-status в PG enum. Другие domains классифицируются по их собственным миграциям; например `workorderstatus`, `wasteorderstatus`, `subscriptionstatus`, work-schedule enums уже создавались как native enum.

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

Production observability по этому контуру развивается отдельно в **PR #283** и не должна быть хаотично смешана с local-runtime hardening.

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

Chat atomicity/idempotency/concurrency hardening развивается отдельно в **PR #282**.

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

Subscreens:

- `OsRoomsScreen`;
- `OsEstimateScreen`;
- `OsPlanTabScreen`;
- `OsProjectProfileScreen`.

Shared callback `onNextTab/goTab` связывает последовательный flow между subsections без создания нового top-level route.

## 8.2. Repair hub

**VERIFIED source:** `OsRepairHubScreen.tsx`.

Tabs:

1. `works` — **Этапы**, primary/default;
2. `control` — **Приёмка**, primary; badge = pending acceptance count;
3. `materials` — **Материалы**, secondary;
4. `selections` — **Подбор**, badge = pending selections; становится secondary при badge=0.

Subscreens:

- `OsWorksScreen`;
- `OsControlScreen`;
- `OsMaterialsScreen`;
- `OsSelectionsScreen`.

Deep-link behavior:

- legacy `tab=calendar` → canonical Calendar hub;
- `subtab=picks|purchases|receipts` → Materials;
- `tab=selections` → Selections.

Pending badge errors fail to zero and проходят через `reportError`, а не отображаются как ложный positive state.

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

**VERIFIED entrypoint:** shared `OsHomeScreen(role)` через role-aware wrappers. Точный текущий component-level inventory должен обновляться при изменении `OsHomeScreen`; здесь не фиксируются непроверенные размеры отдельных локальных блоков. Canonical Home обязан оставаться orchestration/attention surface, а не копировать все secondary centers.

## 8.5. Chat

**VERIFIED route:** обязательный dock area для обеих ролей. Message atomicity/idempotency, thread ACL и delivery consistency развиваются/проверяются отдельно в PR #282. До merge #282 этот документ не должен объявлять соответствующий контур `CI VERIFIED` только на основании #286.

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

Theme sizes:

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

Canonical hub/list filter language:

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
- secondary tabs скрываются за `Все`, пока не раскрыты или пока current value не secondary.

## 9.8. UI constraints

Design-system rule:

- максимум 1 primary CTA на экран;
- максимум 4 hub tabs без progressive disclosure/«Ещё»;
- statuses только через `StatusPill` semantic tones;
- emoji не используются как operational icons; используются `Ionicons`;
- user UI не показывает runtime/dev strings;
- primary/outline/danger semantics не смешиваются;
- customer FAB: Расход · Сообщение · Замечание · Фото; «Черновик» не является быстрым действием.

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

Точные обязательные поля и validations берутся из `project_creation` schemas/service; здесь они не дублируются без source verification.

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

## 10.3. Materials/procurement

```text
material need / MaterialPick
→ approval/readiness
→ Purchase
→ PurchaseItem
→ ordered/paid/partial/delivered/returned/cancelled states
→ receipt/evidence
→ expense/payment recognition according to financial semantics
```

`MaterialPick`, `Purchase`, `Receipt`, `Expense`, `Payment` не являются взаимозаменяемыми сущностями.

## 10.4. Selections

```text
room × category × SKU × allowance
→ draft
→ proposed
→ approved | rejected
→ downstream procurement where applicable
```

UI entrypoint: `Ремонт → Подбор`; pending count может поднимать вкладку из secondary disclosure.

## 10.5. Payments

```text
business obligation
→ payment record/state
→ checkout/provider or documented manual flow
→ pending/processing/unverified/confirmed/etc.
→ provider/bank reconciliation
→ financial recognition rules
```

Нельзя считать provider timeout или локальный UI success окончательным подтверждением денег.

## 10.6. Documents

```text
Document Center
→ upload/store
→ metadata/access control
→ OCR where requested
→ sign/e-sign where requested
→ archive/restore/legal hold/delete lifecycle
```

Object storage и document ACL — security boundary.

## 10.7. Chat

```text
Project/authorized thread
→ participant ACL
→ message mutation
→ durable authoritative message
→ delivery/notification side effects
```

Atomicity/idempotency implementation status должен отражать #282, а не предполагаться.

## 10.8. Warranty

Warranty остаётся отдельным bounded contour в **PR #287**. Canonical IA entry сейчас — Document Center/deeplink `warranty-claim`; нельзя смешивать warranty implementation в local runtime PR #286.

---

# 11. Calculations and derived state

## 11.1. Currency formatting

**VERIFIED:** `formatRub(amount)` использует `Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 })`.

## 11.2. Budget/financial calculations

**RULE:** конкретная формула должна быть документирована только после trace от source entities до calculation function и tests. На уровне semantics обязательны:

- отсутствие двойного признания одной economic operation;
- явное отношение estimate/commitment/purchase/expense/payment/receipt/refund/change order;
- явная обработка pending/cancel/refund/dispute;
- partial/overpayment где применимо;
- reconciliation с bank/provider evidence.

**TBD / UNVERIFIED в этой редакции:** полный каталог всех числовых formulas по каждому dashboard KPI. Следующий documentation pass должен автоматически собрать calculation registry из `apps/mobile/lib/domain/*`, backend services и соответствующих tests; до этого запрещено придумывать формулы по UI labels.

## 11.3. Project progress / schedule calculations

Имеются отдельные domain tests/functions для project progress, project lifecycle, phase, schedule execution stats, stage/room matrix и estimate layers согласно `package.json` mobile test chain. Точные формулы должны быть перенесены в calculation registry после чтения каждого source implementation; наличие теста не заменяет описание математической формулы.

---

# 12. Error, loading, empty and stale states

Обязательный product contract для critical surfaces:

- loading;
- empty;
- error;
- retry where safe;
- stale/offline state where applicable;
- success/confirmed state;
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

---

# 14. Tests and verification matrix

## 14.1. Local developer/agent gates

- `doctor` — prerequisites + local safety boundary;
- `bootstrap` — exact locked dependency installation;
- `check` — PostgreSQL/Redis/MinIO/API health+ready/Alembic head/worker heartbeat;
- `test-focused` — fast local contract gate;
- `test-full` — обязан выполнить focused first, затем full backend pytest + mobile typecheck + mobile contracts.

## 14.2. Root test surfaces

Подтверждены `package.json` entry points:

- `mobile:test` — большая цепочка domain/navigation/reliability/fail-closed contracts;
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

## 14.3. Local runtime workflow

`Canonical local runtime integrity` доказывает на PR candidate:

1. exact Node/Python/Poetry setup;
2. materialize `.env.local`;
3. negative local safety tests;
4. locked bootstrap with no lock mutation;
5. source + Compose contract;
6. full backend topology start without Expo;
7. runtime truth check;
8. focused local contracts;
9. diagnostics on failure;
10. cleanup.

## 14.4. Current evidence status

**PENDING REVERIFY after `w16legacystatus01`.** До этой repair migration local-runtime startup доходил через Alembic до `w15providerops01`, затем API падал на отсутствующем PG type `materialpickstatus`. Это и стало evidence для schema/model parity repair.

Предыдущие green workflow results на более старом SHA нельзя автоматически переносить на новый candidate. После любых commits к #286 окончательный verdict должен строиться по workflow runs exact final SHA.

---

# 15. Независимые критические PR-контуры

Эти контуры намеренно остаются разделёнными:

- **#282 — chat atomicity/idempotency/concurrency**;
- **#283 — production observability**;
- **#284 — backup/restore/DR**;
- **#287 — warranty implementation**;
- **#286 — canonical local runtime + agent instruction/local parity hardening**.

Техническая спецификация может описывать их связи, но кодовые changes не должны переноситься между PR без отдельной причины/review. После merge каждого контура этот документ обновляется новым фактическим состоянием.

---

# 16. Known gaps / improvement backlog

## P0 — до признания #286 merge-ready

1. **PENDING:** прогнать exact-head Alembic chain с `w16legacystatus01` на чистом PostgreSQL.
2. **PENDING:** доказать API/worker health/readiness после enum repair.
3. **PENDING:** focused local contracts на exact final SHA.
4. **PENDING:** проверить общий CI exact final SHA; старые green SHAs не являются доказательством нового head.
5. **PENDING:** при необходимости добавить отдельный migration/schema parity regression, если runtime-only gate недостаточно локализует будущий drift.

## P0 external

- GitHub `main` branch protection/ruleset остаётся external configuration fact и не может считаться включённым только по repo code. Статус должен подтверждаться GitHub configuration evidence и negative test.

## P1 — living documentation coverage

1. Собрать **calculation registry**: каждая KPI/formula → source function → inputs → statuses → test.
2. Собрать **API endpoint catalog** автоматически из FastAPI/OpenAPI на clean runtime: method/path/schema/auth/idempotency/error classes.
3. Собрать **screen contract catalog** для каждого secondary/deeplink route: role, data sources, filters, CTA, empty/error/offline state, destination links.
4. Добавить visual regression/screenshots для canonical hubs после стабилизации product UI.
5. Проверить локальные StyleSheet deviations от design tokens и вынести исключения либо устранить.

## P1/P2 — architecture quality

- продолжать удалять duplicate legacy routes после canonical replacements;
- не создавать role-forked screen implementations при наличии shared role-aware screen;
- усиливать source-level traceability между entity → service → API → mobile → E2E;
- не объявлять staging/provider/backup/alert/store behavior VERIFIED без retained external evidence.

---

# 17. Traceability matrix

| Product concern | Source of truth | Verification |
|---|---|---|
| engineering policy | `AGENTS.md` | source contract/PR review |
| local runtime | `scripts/dev-runtime.sh`, Compose, env local | local-runtime CI |
| DB schema | Alembic | clean PostgreSQL upgrade/head check |
| ORM/domain types | `entities.py` | backend tests + runtime |
| API composition | `api/v1/router.py` | API tests/OpenAPI/E2E |
| mobile IA | `routeRegistry.ts` | routeRegistry tests/mobile tests |
| role shell | Expo route wrappers + shared Os screens | mobile contracts/E2E |
| design tokens | Theme/typography/uiTokens/screenLayout | UI contract/static review |
| hub tabs | `OsHubTabs` + hub screens | mobile contracts/E2E |
| finance | entities/services/domain calculation functions | finance-specific tests + PostgreSQL concurrency where required |
| chat | chat service/API/mobile | #282 tests/E2E/load |
| observability | logging/probes/runbook | #283 + external evidence |
| DR | restore scripts/runbook/workflow | #284 drill evidence |
| warranty | warranty service/API/mobile | #287 workflow/tests |
| release/readiness | readiness docs/evidence + exact artifacts | release workflows/external proof |

---

# 18. Documentation Definition of Done

Изменение Renova считается документировано только если:

- изменённый behavior имеет канонический owner/source;
- route/API/entity/state/financial meaning не дублируется в противоречащем виде;
- новая/изменённая navigation связь отражена здесь или явно объявлена internal-only;
- UI measurement берётся из shared token/component либо исключение объяснено;
- critical flow имеет loading/error/success and fail-closed semantics;
- тест/evidence уровень назван честно (`TESTED`, `CI VERIFIED`, `STAGING VERIFIED`, etc.);
- known gap не замаскирован optimistic wording;
- при изменении source snapshot обновлены соответствующие traceability rows.

---

# 19. Change log

### 2026-08-28 — living specification v1

- создан единый technical/product dossier;
- зафиксированы runtime, domains, API groups, mobile IA, role-sharing principle;
- зафиксированы Object/Repair/Budget hub contracts;
- зафиксированы точные UI tokens, typography, filter chips, hub-tabs geometry;
- зафиксирован status enum parity defect и repair `w16legacystatus01`;
- отделены #282/#283/#284/#287 от #286;
- сформирован P0/P1 documentation and verification backlog.

Следующая редакция должна обновить `Current evidence status` после exact-head CI и расширить calculation + endpoint + secondary-screen registries только на основе прочитанных source implementations/tests.
