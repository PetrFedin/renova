# Renova — каталог экранных контрактов

**Статус:** ACTIVE / LIVING ANNEX  
**Главный документ:** `docs/RENOVA-TECHNICAL-SPECIFICATION.md`  
**Назначение:** screen-by-screen контракт: роль, входной route, данные, вкладки/фильтры, действия, связи, состояния и UI geometry. Этот каталог не должен дублировать JSX буквально; он фиксирует продуктовый контракт и точные shared design rules.

---

# 1. Общая screen architecture

## 1.1. Role wrappers

Customer и contractor должны использовать shared role-aware `Os*Screen`, когда бизнес-смысл экрана общий.

```text
(customer)/(tabs)/...   ─┐
                         ├─> OsHomeScreen / OsObjectHubScreen / OsRepairHubScreen / OsBudgetHubScreen
(contractor)/(tabs)/... ─┘
```

Это anti-drift rule: запрещено создавать две независимые реализации одного hub только из-за роли, если различия можно выразить через `role`, capabilities/access mode или отдельный subview.

## 1.2. Screen spacing

Shared:

```text
horizontal screen padding = 16
bottom content padding     = 32
minimum touch target       = 44
base card radius           = 12
base card padding          = 12
base card border           = 1
base card marginBottom     = 8
```

## 1.3. PrimaryButton

**VERIFIED. Source:** `apps/mobile/components/renova/PrimaryButton.tsx` blob `b1dab4b50ae2b5e078024e16a3b0c37120c996a1`.

Variants:

```text
primary | secondary | outline | ghost | danger | dangerOutline
```

Sizes:

| size | vertical padding | horizontal padding | font |
|---|---:|---:|---:|
| sm | 7 | 10 | 12 (caption) |
| md | 10 | 14 | 14 (body) |
| lg | 12 | 18 | 14 (body) |

`compact` deprecated и эквивалентен `size="sm"`.

Общее:

- `minHeight = 44`;
- radius = 10;
- text weight = semibold;
- disabled/loading → interaction blocked + accessibilityState;
- disabled opacity 0.45;
- pressed opacity 0.85;
- haptic = light impact;
- `fullWidth` → width 100%.

---

# 2. Canonical top-level IA

```text
Главная | Объект | Ремонт | Бюджет/Деньги | Сообщения
```

Calendar/Сроки — secondary/optional dock entry. Documents, approvals, inbox, reports, activity и другие centers не должны создавать дубли top-level domain hubs.

Полная route registry остаётся в главном ТЗ и `apps/mobile/lib/routeRegistry.ts`.

---

# 3. Object hub

**Source:** `OsObjectHubScreen.tsx` blob `3082b1bf59cbf420d403ed82b35bbc2e78697728`.

Route:

```text
/{customer|contractor}/object
```

Tabs:

| key | label | priority | screen |
|---|---|---|---|
| rooms | Комнаты | primary/default | `OsRoomsScreen` |
| estimate | Смета | primary | `OsEstimateScreen` |
| plan | План | secondary | `OsPlanTabScreen` |
| profile | Данные | secondary | `OsProjectProfileScreen` |

`goTab/onNextTab` обеспечивает последовательные переходы между subsections без создания дополнительного top-level route.

### UI contract

- tabs — `OsHubTabs`, underline navigation;
- secondary tabs скрываются за progressive disclosure `Все`;
- текущая secondary tab остаётся видимой, даже если disclosure не открыт;
- screen content использует shared screen layout/tokens.

### Functional intent

```text
Данные объекта
→ комнаты/геометрия
→ план
→ смета
→ downstream execution
```

Точная обязательность полей создаваемого проекта должна выводиться из project creation schemas/service, не из UI labels.

---

# 4. Repair hub

**Source:** `OsRepairHubScreen.tsx` blob `5fe0e6229ad4cc82462ea4cfc1f7d213c7687305`.

Tabs:

| key | label | priority | badge | screen |
|---|---|---|---|---|
| works | Этапы | primary/default | — | `OsWorksScreen` |
| control | Приёмка | primary | pending acceptance | `OsControlScreen` |
| materials | Материалы | secondary | — | `OsMaterialsScreen` |
| selections | Подбор | secondary when no pending | proposed selection count | `OsSelectionsScreen` |

Deep link normalization:

```text
legacy tab=calendar               → Calendar hub
subtab=picks|purchases|receipts   → Materials tab
repair tab=selections             → Selection tab
```

Badge loading failure должен fail-to-zero и пройти через `reportError`; нельзя показывать fabricated positive attention count.

---

# 5. Materials / procurement screen

**Sources:** `OsMaterialsScreen.tsx` + `MaterialPickList.tsx`; implementation blobs machine-tracked in `SCREEN-SOURCE-SNAPSHOT.md`.

## 5.1. Data load

Screen одновременно загружает:

```text
MaterialPick[]
Purchase[]
Receipt[]
```

через `Promise.all`. Load failure должен отображать explicit error state; ошибка получения procurement данных не трактуется как «нулевые закупки».

## 5.2. Subtabs

```text
picks      → Потребности
purchases  → Закупки
receipts   → Чеки
```

## 5.3. Material filters and supply truth

```text
all        Все
buy        Купить
ordered    Согласовано
available  Доступно
shortage   Не хватает
```

Canonical quantity semantics:

```text
required      = max(qty_needed ?? qty, 0)
available     = max(qty_available, 0) + max(qty_delivered, 0)
qty_to_buy    = buy-required source ? max(required - available, 0) : 0
material_available = available >= required

buy       = qty_to_buy > 0
ordered   = status == approved
available = material_available
shortage  = !material_available
```

`buy` означает реальную незакрытую потребность в покупке, а не lifecycle-статус строки. `draft`/`pending` могут требовать согласования, но сами по себе не означают, что материал надо покупать.

Attention metrics:

```text
needBuy   = count(qty_to_buy > 0)
approved  = count(status == approved)
available = count(material_available)
shortage  = count(!material_available)
openPurchases = count(status not in {delivered, cancelled, returned})
unverifiedReceipts = count(!receipt.verified)
```

`readyCount` вычисляется только через `readyPickIds(picks, purchases, role)` и дополнительно требует:

```text
status == approved
current role owns purchase responsibility
qty_to_buy > 0
pick is not already in an active purchase
```

Следствие: сводка «Нужно купить» и CTA «Создать закупку» не могут расходиться из-за одного лишь статуса MaterialPick.

## 5.4. Material source / responsibility card

Каждая MaterialPick остаётся единственным material master и показывает в существующей карточке:

```text
source label
Доступно X из Y <unit>
к покупке Z              # только когда Z > 0
```

Canonical source labels:

```text
customer_on_hand      У заказчика
customer_to_buy       Покупает заказчик
contractor_to_buy     Покупает исполнитель
contractor_included   Включено в работы
third_party           Поставляет третья сторона
```

Customer и assigned contractor могут менять source/availability только при write access; backend повторно проверяет exact project principal. Viewer/crew/supervisor не получают это право только потому, что могут читать проект.

Изменение source/availability после `approved`:

```text
approved
→ supply truth changed
→ pending
→ material dependency re-evaluated
→ explicit customer re-approval required
```

Физическое наличие материала не обходит approval и не создаёт `Stage.active`. Начало этапа по-прежнему принадлежит canonical stage-start transition.

Для `customer_on_hand` всё требуемое количество должно быть доступно. `customer_to_buy` / `contractor_to_buy` могут иметь частично доступное количество; закупка создаётся только на остаток. `contractor_included` / `third_party` / `customer_on_hand` не создают фиктивные Purchase/Payment/Expense.

Изменение ответственности/наличия должно иметь durable audit intent в той же business transaction; inline Activity/notification не является единственной копией истории.

## 5.5. Main actions

В зависимости от `procurementNextAction` screen ведёт к следующему допустимому шагу, включая:

- сформировать потребности;
- согласовать material picks;
- подтвердить наличие внешне обеспеченного материала;
- создать закупку только для approved позиций текущей ответственной роли;
- перейти к существующей purchase lifecycle;
- сканировать/проверить receipt;
- завершённое состояние/reload.

После создания purchase screen переключается в purchases subtab.

Contractor имеет переход:

```text
Подбор чистовых → Repair / Selections
```

Purchase cancellation — destructive financial action с explicit confirmation («Убрать из факта?»), после чего backend refresh обязан синхронизировать ledger.

Receipt QR scan → receipt evidence/reconcile flow; факт нельзя считать подтверждённым только по локальному успешному скану.

## 5.6. #305 mobile design-system contract

- один вертикальный `ScrollView`;
- summary/next-action не создают параллельный material screen;
- основной CTA — shared `PrimaryButton`;
- material source options и filters используют shared chip styles;
- typography/list geometry — `screenTypography` / `listRowStyles`;
- interactive inputs/toggles соблюдают `RenovaTheme.minTouch` / минимум 44;
- disabled/loading/accessibility states должны блокировать competing mutations;
- customer/contractor используют одну shared визуальную систему, различия выражаются ролью/capability, а не отдельной копией экрана.

---

# 6. Selections screen

**VERIFIED. Source:** `OsSelectionsScreen.tsx` blob `9ccb7fa6b1df87d21372369de73b748f8c7779e1`.

Business flow:

```text
исполнитель создаёт draft
→ отправляет proposed
→ заказчик approved | rejected
→ approved может перейти в materials/procurement
```

## 6.1. Categories

```text
all        Все
tile       Плитка
plumbing   Сантехника
lighting   Свет
doors      Двери
kitchen    Кухня
paint      Краска
other      Другое
```

## 6.2. Status labels

```text
draft     Черновик
proposed  На согласовании
approved  Согласовано
rejected  Отклонено
```

## 6.3. Permissions

```text
canWrite = !readOnly && role != customer
```

Следствие:

- contractor создаёт/редактирует предложение;
- customer не создаёт SelectionItem;
- customer принимает/отклоняет `proposed`;
- read-only mode блокирует mutation actions.

## 6.4. Create form

Поля:

- Название / SKU — обязательно; blank → validation alert;
- Цена ₽ — `Number(price) || 0`;
- allowance ₽ — nullable number;
- category — текущий filter; если `all`, сохраняется `other`.

Mutation поддерживает offline queued state: UI обязан сообщать, что операция поставлена в очередь, а не выдавать её за server-confirmed completion.

## 6.5. Attention and cross-links

```text
pending = count(status == proposed)
```

Customer при pending > 0 получает warning banner.

Contractor при наличии approved items получает переход:

```text
Согласованные → Материалы / закупки
```

Empty state:

- contractor → `Предложить позицию`;
- customer → `Написать в чат`.

`over_allowance=true` → explicit warning `Выше лимита allowance`.

## 6.6. State actions

Contractor:

```text
draft    → На согласование
rejected → Отправить снова
```

Customer:

```text
proposed → Согласовать | Отклонить
```

Approve использует pre-confirm dialog; после mutation вызывается project side-effect sync и alert/navigation feedback.

---

# 7. Control / Acceptance screen router

**VERIFIED. Source:** `OsControlScreen.tsx` blob `b33fe8343d7629fd5ac859009ebdff36da629810`.

Dispatch:

```text
if activeProject.access_mode == supervisor:
    TechnicalSupervisionControlView
else if role == contractor:
    ContractorControlView
else:
    CustomerControlView
```

Это позволяет иметь общий `Repair → Приёмка` entrypoint при разной decision authority.

---

# 8. Customer Control view

**VERIFIED. Source:** `CustomerControlView.tsx` blob `da4faeed719c936af4daf0b7b7b6b69b7c16c0e9`.

Loads concurrently:

```text
issues
work acceptances
warranty claims
```

Error → `LoadErrorState` + retry + customer chat CTA.

## 8.1. Summary row

Three metrics:

```text
Приёмка   = computePendingAcceptanceCount(stages, acceptances)
Замечания = openIssues.length || rework.length
3rd cell  = warrantyOpen || count(open high/critical issues)
label     = Гарантия if warrantyOpen else Критичные
```

## 8.2. Acceptance decisions

Main block: `UnifiedAcceptanceList` with role customer.

Decision hint explicitly instructs customer to accept or return for rework only after actual inspection.

## 8.3. Warranty block

Visible when `warrantyOpen > 0` or `focus=warranty`.

- focus mode moves Warranty block before normal decision content;
- each open claim links to QC issue route;
- button `Все гарантии (QC)` opens QC;
- warranty implementation/idempotency remains separate PR #287; this UI presence не означает #287 merge status.

## 8.4. Issues

Only open issues are listed; focusIssueId moves target first. First five are shown before `Все замечания (QC)`.

Per issue:

- title may indicate photo/plan;
- meta: severity, status, due date, linked stage;
- floor plan issue → `→ На план`;
- customer can close or confirm fixed issue if not read-only;
- mutation protected by explicit pre-confirm dialog;
- offline queue receives truthful queued feedback.

Rework stages are listed separately and link to stage details.

---

# 9. Contractor Control view

**VERIFIED. Source:** `ContractorControlView.tsx` blob `dc2d3793252be1668ffe720e98cf1572c7d9c085`.

Loads:

```text
issues
work acceptances
```

Summary:

```text
Приёмка   = pending acceptance count
Замечания = open issues count || rework count
Критичные = count(high | critical issues)
```

Acceptance list is read as `Решение у заказчика`; contractor не получает customer final acceptance authority.

For ordinary open issue contractor can select `Исправлено` after explicit confirm. If backend returns status `fixed`, customer is notified for confirmation.

Warranty issue special rule:

```text
title startsWith "[Гарантия]"
→ contractor does not close through ordinary issue action
→ UI says warranty is closed by customer in Documents
```

Rework stages link to stage detail.

---

# 10. Technical Supervision Control view

**VERIFIED. Source:** `TechnicalSupervisionControlView.tsx` blob `3f9ca8a779a96f74f25cef885004301b423a681e`.

Access condition:

```text
activeProject.access_mode == supervisor
```

Capabilities:

```text
quality_issue_write → can create technical quality issue
quality_review      → can return stage for technical rework
```

Boundary text is explicit:

- supervisor can document defects;
- supervisor can return works for rework when capability allows;
- final acceptance, payments, estimate and contractual decisions remain with customer.

Loads:

```text
work acceptances
issues
```

Pending technical review:

```text
acceptance.status ∈ {requested, in_review}
```

Stage selection opens review box.

### Create technical remark

Requirements:

```text
selectedStageId
remark.trim() != empty
quality_issue_write capability
```

Created issue:

```text
title       = "Замечание: <stage name>"
description = remark
stage_id    = selected stage
severity    = medium
```

### Return for rework

Requirements:

```text
selectedStageId
remark.trim() != empty
quality_review capability
```

Requires destructive confirm; user copy explicitly preserves customer final acceptance boundary.

### Geometry

- content padding 16, bottom 32;
- review TextInput minHeight 100;
- local action buttons minHeight 44;
- button radius 8;
- action gap 8;
- cards use shared base `card`.

### Consistency debt — VERIFIED

This view still renders review actions with local `Pressable` button styles instead of shared `PrimaryButton` variants. Touch target and theme colors are aligned, but component-level consistency is not. Refactor belongs in a bounded UI/design-system change, **not** in #286 runtime hardening unless explicitly re-scoped/reviewed.

---

# 11. Budget hub

Sources: `OsBudgetHubScreen.tsx`, `budgetTabs.ts`.

Tabs:

| key | label | priority |
|---|---|---|
| summary | План–факт | primary/default |
| expenses | Расходы | secondary |
| payments | Оплаты | primary |
| deviations | Отклонения | secondary |

Legacy query normalization:

```text
rooms      → expenses + view=rooms
stages     → expenses + view=stages
analytics  → deviations
unknown    → summary
```

Expense views:

```text
list | rooms | stages
```

Financial formulas and ledger ownership: `docs/technical-spec/CALCULATION-REGISTRY.md` + `docs/BUDGET_FACT.md`.

---

# 12. Hub tab component geometry

**Source:** `OsHubTabs.tsx` blob `f480067b06c750623e4091fe0db128c877e3fb37`.

Tabs are underline navigation, not pill cards.

```text
container bottom hairline border
row HP=8, top=4, gap=4
tab HP=12, VP=10
active underline=2
label 14/500
active label 14/700
badge minWidth=16, height=16, radius=8, HP=4
badge text 9/800
badge count > 9 → "9+"
```

Secondary tabs are hidden behind `Все` until expanded unless the active tab itself is secondary.

---

# 13. Standard state contract

Critical screens should explicitly distinguish:

```text
no active project
loading
loaded + empty
loaded + data
load error
retry
read-only
mutation busy
mutation queued offline
mutation confirmed
mutation conflict/rejected where applicable
```

A dependency/API failure must never silently render as business-empty if that would change the user’s decision.

---

# 14. Navigation/decision rules

1. One product meaning → one canonical route/hub.
2. Legacy aliases normalize to canonical destination; they do not become parallel products.
3. Detail screens must have an unambiguous route back to their owning hub.
4. Cross-domain transitions should reflect business handoff, e.g. approved Selection → Materials/procurement.
5. Read-only/viewer/supervisor modes must fail closed on mutations.
6. Offline queued mutation is not server-confirmed success.
7. Provider/local callback success is not final financial truth until authoritative reconciliation.

---

# 15. Screen documentation backlog

Следующий verified pass должен добавить такие же контракты для:

- `OsHomeScreen` — полный KPI/action inventory;
- `OsRoomsScreen`;
- `OsEstimateScreen`;
- `OsPlanTabScreen`;
- `OsProjectProfileScreen`;
- `OsWorksScreen` / Stage detail;
- Budget Summary / Expenses / Payments / Deviations;
- Chat inbox/thread;
- Documents / OCR / e-sign;
- Inbox / Approvals / Activity;
- Calendar;
- Reports / Manager Dashboard;
- QC issue detail;
- Warranty после #287;
- portal/guest flow;
- auth/OTP/session screens;
- admin surfaces.

Для каждого следующего экрана обязательны: route, audience, access guard, data sources, derived metrics, filters, actions, state transitions, error/empty/loading/offline states, UI primitives, exact non-token geometry, cross-links и test/evidence pointer.
