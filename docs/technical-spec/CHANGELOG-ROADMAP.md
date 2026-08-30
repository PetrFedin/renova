# Renova — журнал изменений ТЗ и управляемый roadmap

**Статус:** ACTIVE / LIVING ANNEX  
**Родительский документ:** `docs/RENOVA-TECHNICAL-SPECIFICATION.md`  
**Назначение:** фиксировать каждое существенное изменение Renova как связку `наблюдение → решение → код/данные → тест → evidence → следующий шаг`, а также хранить приоритизированный план дальнейшего развития.

---

## 1. Правило ведения

Любое изменение, затрагивающее product behavior, schema/model, navigation, API, calculation, role/ACL, UI contract, runtime, provider boundary или E2E flow, должно в том же рабочем контуре иметь запись здесь либо в специализированном annex с обратной ссылкой.

Для каждой записи обязательны:

1. дата;
2. приоритет `P0/P1/P2/P3`;
3. исходный факт/дефект;
4. доказательство источником или CI;
5. принятое решение;
6. изменённые authoritative sources;
7. тест/verification gate;
8. текущий статус;
9. остаточный риск/следующий шаг.

Статусы evidence совпадают с master dossier: `VERIFIED`, `CI VERIFIED`, `PENDING REVERIFY`, `TBD / UNVERIFIED`, `STAGING VERIFIED`, `PRODUCTION VERIFIED`.

Нельзя закрывать пункт только потому, что код написан. Закрытие требует предусмотренного для него verification gate.

---

# 2. Change log

## 2026-08-28 — P0 — полный остаточный native PostgreSQL enum parity: `w18nativeenumparity01`

### Исходный факт

После добавления generic native-enum проверки exact candidate `df759e37f9afdf1f983c2c770acf5c66865bae9e` успешно прошёл:

- revision guard;
- reject empty PostgreSQL;
- clean `alembic upgrade head` через `w17chatmessageenum01`;
- `verify_current_migration_schema.py` для migration-owned w16/w17 invariants.

Затем `verify_orm_schema_parity.py` честно остановил `Database schema integrity` и показал **ровно три** оставшихся historical mismatch. Это считается полезным red-team evidence, а не поводом ослаблять verifier.

### Mismatch 1 — `app_notifications.notification_type`

**Migration history:**

- base `14ef20b1cf11_v14.py` создал `notificationtype`:

```text
stage_review
payment_pending
change_order
room_change
chat_message
```

- `w7x8y9z0a1b2_payment_confirmed_notification.py` добавил только `payment_confirmed` через `ALTER TYPE ... ADD VALUE`;
- current ORM `NotificationType` содержит 18 labels:

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

**Вывод:** это доказанный model-only enum growth без соответствующих migrations.

### Mismatch 2 — `job_leads.status`

**Migration history:** `w1softdelete01_soft_delete_lead_quotes.py` прямо создавал `job_leads.status` как:

```text
VARCHAR(32) DEFAULT 'open'
```

поскольку таблица исторически жила только через `create_all`/SQLite.

Current ORM связывает колонку с native `JobLeadStatus`:

```text
open | quoted | taken | closed
```

**Вывод:** тот же подтверждённый storage/model drift class, что и legacy status columns в `w16`.

### Mismatch 3 — `payments.status`

**Migration history:**

- base v14 создал `paymentstatus` в порядке:

```text
pending | confirmed | cancelled
```

- `z0a1b2c3d4e5_payment_status_sm.py` затем последовательно append'ил:

```text
processing | paid_unverified | disputed | refunded
```

Физический PG order стал:

```text
pending
confirmed
cancelled
processing
paid_unverified
disputed
refunded
```

Current ORM order:

```text
pending
processing
paid_unverified
confirmed
cancelled
disputed
refunded
```

Проверка `payment_service.py` показывает, что state machine задаётся explicit equality/`IN`/allowed-from sets. Ordinal comparison PostgreSQL enum не является business rule. Поэтому historical append order — случайный storage artifact, а не каноническая последовательность состояния.

### Принятое решение — `w18nativeenumparity01`

Одна migration закрывает **полный список**, полученный generic verifier после w17:

1. `notificationtype` пересоздаётся в exact ORM order и расширяется до 18 labels;
2. `job_leads.status` валидируется и переводится `VARCHAR(32) → native jobleadstatus`;
3. `paymentstatus` losslessly пересоздаётся с тем же набором labels, но exact ORM order.

### Fail-closed правила

- migration принимает только точное известное historical либо уже exact current состояние;
- все persisted values проверяются до преобразования;
- неизвестный row value или неожиданный PG enum state останавливает upgrade;
- `JobLead` сохраняет server default `open` после conversion;
- Payment rebuild не меняет набор values, только canonical order;
- downgrade Notification разрешён только если строки ещё не используют labels, отсутствующие в historical enum;
- downgrade Payment lossless — набор labels одинаков;
- downgrade JobLead возвращает `VARCHAR(32) DEFAULT 'open'`.

### Почему generic verifier остаётся строгим по order

Ordered PG enum labels являются частью физической schema semantics: PostgreSQL поддерживает enum comparison/order. Даже если конкретный сервис сейчас не использует `<`/`>`, silent divergence создаёт скрытую будущую семантику. Поэтому verifier сравнивает exact ordered labels, а state-machine code обязан использовать explicit transition rules вместо ordinal enum ordering.

### Verification chain

После `w18` обязательны:

```text
clean PostgreSQL
→ upgrade to w18
→ reflected current-schema invariants
→ generic ORM table/column/native-enum parity
→ accept current head
→ downgrade new migrations
→ verify removal / reject stale schema
→ replay to w18
→ reflected + generic parity again
→ accept current head
```

И отдельно canonical local:

```text
start
→ check
→ seed
→ seed повторно
→ check
→ focused contracts
```

### Authoritative sources

- `backend/alembic/versions/14ef20b1cf11_v14.py`
- `backend/alembic/versions/w7x8y9z0a1b2_payment_confirmed_notification.py`
- `backend/alembic/versions/z0a1b2c3d4e5_payment_status_sm.py`
- `backend/alembic/versions/w1softdelete01_soft_delete_lead_quotes.py`
- `backend/alembic/versions/w18nativeenumparity01_remaining_native_enum_parity.py`
- `backend/app/models/entities.py`
- `backend/app/services/payment_service.py`
- `backend/scripts/verify_orm_schema_parity.py`
- `backend/scripts/verify_current_migration_schema.py`

### Статус

**PENDING REVERIFY.** Реализация записана; закрытие требует exact-head CI после синхронизации master dossier и drift gates.

---

## 2026-08-28 — P0 — canonical local runtime: второй schema/model enum drift

### Исходный факт

Exact candidate `d88af75bbdb1d594f10145be37d53347c02e60a1` имел 26/27 successful GitHub Actions workflows. Единственным failure был `Canonical local runtime integrity` на реальном full-backend startup.

Runtime дошёл через Docker/locked bootstrap/Compose/PostgreSQL/Redis/MinIO/Alembic, после чего API вошёл в restart-loop внутри старого startup demo seed.

### Доказанные причины

1. PostgreSQL enum `chatmessagetype`, созданный базовой migration `14ef20b1cf11_v14.py`, содержал только:
   - `text`;
   - `photo`;
   - `confirm`;
   - `system`.
2. Current ORM `ChatMessageType` и mobile chat contract уже используют:
   - `text`;
   - `photo`;
   - `file`;
   - `confirm`;
   - `system`;
   - `task`;
   - `invoice`;
   - `payment`.
3. `verify_orm_schema_parity.py` до исправления проверял таблицы/имена колонок, но **не** native PostgreSQL enum name/labels, поэтому этот drift не был виден в schema CI.
4. `create_work_order()` создаёт domain-owned thread `work:<id>` и сохраняет FK в `work_orders.chat_thread_id`.
5. Legacy demo seed удалял любой project chat, не входящий в список demo-title. После частично выполненного seed это приводило к попытке удалить work-order thread и FK failure.
6. API lifespan автоматически запускал demo seed при каждом startup/restart, хотя canonical developer interface уже разделяет `start` и explicit `seed`.

### Принятое решение

#### A. Schema parity

Добавлена migration `w17chatmessageenum01` поверх `w16legacystatus01`.

Desired PostgreSQL `chatmessagetype` contract:

```text
text
photo
file
confirm
system
task
invoice
payment
```

Upgrade допускает только точное legacy-состояние либо уже точное current-состояние. Неизвестная промежуточная комбинация labels останавливает migration fail-closed.

Downgrade запрещён, если `file/task/invoice/payment` уже используются строками `chat_messages`; silent data loss не допускается.

#### B. Общая защита enum parity

`backend/scripts/verify_orm_schema_parity.py` расширен: для каждой mapped SQLAlchemy `Enum(native_enum=True)` он обязан сравнивать с PostgreSQL:

- факт native `ENUM` storage;
- имя PG enum type;
- ordered enum labels.

Это превращает проверку из `table/column parity` в `table/column/native-enum parity`.

`backend/scripts/verify_current_migration_schema.py` дополнительно фиксирует migration-owned invariant `chat_messages.message_type → chatmessagetype` с полным ordered value set.

#### C. Startup lifecycle

`backend/app/main.py` больше не запускает `ensure_demo_users()` и `seed_articles()` в lifespan.

Canonical invariant:

```text
start = поднять runtime, не мутируя demo business data
seed  = явная development-only operator action после migration/head/runtime checks
```

Explicit entry point остаётся:

```bash
npm run dev -- seed
```

который вызывает `python -m app.dev_seed` внутри canonical API container.

#### D. Seed preservation rule

`seed_demo.py` больше не классифицирует произвольные/e2e/domain chats как «мусор» и не очищает весь project chat namespace.

Разрешено дедуплицировать только собственные canonical demo-title. Любой thread, название которого не входит в текущий demo allow-list, сохраняется без удаления.

Это защищает как минимум work-order chat FK и исключает потерю пользовательских/local-development chat data от повторного seed.

### Verification chain после изменения

`Canonical local runtime integrity` теперь обязан выполнить:

```text
locked bootstrap
→ source/Compose contract
→ full backend topology start
→ runtime check
→ explicit seed
→ explicit seed повторно
→ runtime check
→ focused local contracts
→ cleanup
```

Повторный seed является обязательным proof идемпотентности и одновременно реальным PostgreSQL proof для `task/payment` chat message types.

### Authoritative sources

- `backend/alembic/versions/w17chatmessageenum01_chat_message_enum_parity.py`
- `backend/app/main.py`
- `backend/app/dev_seed.py`
- `backend/app/services/seed_demo.py`
- `backend/scripts/verify_orm_schema_parity.py`
- `backend/scripts/verify_current_migration_schema.py`
- `.github/workflows/local-runtime-integrity.yml`
- `scripts/devRuntimeContract.test.mjs`

### Статус

**PENDING REVERIFY** — final exact-head CI после полного пакета изменений ещё должен завершиться. Старые green checks не переносятся автоматически.

---

## 2026-08-28 — P0 — legacy status storage parity

### Факт

Canonical PostgreSQL runtime ранее выявил ORM/native-enum mismatch для legacy VARCHAR status columns.

### Реализация

Migration `w16legacystatus01`:

- `purchases.status` → `purchasestatus`;
- `material_picks.status` → `materialpickstatus`;
- `selection_items.status` → `selectionstatus`.

Migration валидирует existing values до cast; downgrade возвращает исходные VARCHAR lengths.

### Evidence до w17

На exact SHA `d88af75bbdb1d594f10145be37d53347c02e60a1` уже были `success`:

- `Database schema integrity` с upgrade/downgrade/replay;
- `Staging runtime integrity`;
- `Provider operations integrity`;
- `Database restore integrity`;
- `Runtime topology integrity`;
- `Backend image integrity`;
- `Push receipt reconciliation integrity`;
- общий `CI`;
- `CodeQL SAST`;
- `Security operations integrity`;
- living technical specification integrity;
- остальные domain integrity workflows — всего 26/27 workflows.

После появления `w17/w18` этот evidence остаётся исторически полезным, но current final candidate должен пройти повторную exact-head проверку.

---

# 3. Приоритизированный roadmap

Roadmap не является списком пожеланий. Работу ведём сверху вниз; следующий пункт берётся только после повторного чтения master dossier, этого annex и текущего CI/evidence.

## P0 — release/runtime correctness

### P0.1. Закрыть canonical local runtime end-to-end

**Gate:** `Canonical local runtime integrity = success` на exact final SHA после `w18` и seed-lifecycle changes.

Definition of Done:

- clean/retained local PostgreSQL проходит migration to current head;
- API/worker healthy;
- `/health` и `/ready` зелёные;
- local + shared Redis worker heartbeat подтверждены;
- explicit seed проходит дважды;
- `task/payment` demo chat messages записываются в PostgreSQL;
- никакой non-demo chat не удаляется seed;
- focused contracts проходят после seed.

### P0.2. Полная native PostgreSQL enum parity

**Gate:** enhanced `verify_orm_schema_parity.py` на clean PostgreSQL после `w18nativeenumparity01`.

Current verified repair set:

- w16: Purchase / MaterialPick / Selection legacy VARCHAR statuses;
- w17: ChatMessageType missing labels;
- w18: NotificationType missing labels/order, JobLead VARCHAR status, PaymentStatus order.

Definition of Done:

- generic verifier сообщает zero mismatch;
- current verifier фиксирует migration-owned enum invariants;
- clean upgrade + downgrade/replay проходят;
- verifier не ослаблен до unordered/set-only comparison.

Если после w18 verifier всё же выявит дополнительный mismatch, он снова классифицируется по migration history и добавляется сюда как новый доказанный факт; mass-cast без анализа запрещён.

### P0.3. Rebase/merge ordering критических PR

Текущие независимые contours:

- #282 chat atomicity/idempotency/concurrency;
- #283 production observability;
- #284 DR;
- #287 warranty;
- #286 runtime/schema/documentation truth.

После schema-owner merge PR #284 обязан rebase и повторно доказать DR against current head. Любой PR, затрагивающий `entities.py`, migration graph или current schema verifier, повторно запускает enum/schema parity.

---

## P1 — product completeness and operational consistency

### P1.1. Полный screen contract inventory

Продолжить `SCREEN-CONTRACT-CATALOG.md` до 100% canonical route/screens:

- Home component inventory;
- Chat inbox/thread/action states;
- Calendar;
- Documents;
- Approvals;
- Reports;
- Inbox/notifications;
- Manager dashboard;
- remaining deeplink/beta routes.

Для каждого: role, entrypoint, data sources, loading/empty/error/stale, filters, CTA, secondary actions, cross-links, permissions, exact shared geometry, tests.

### P1.2. UI consistency debt

Известный пункт: часть Technical Supervision control actions реализована local `Pressable` styling вместо shared `PrimaryButton`.

Следующий UI pass должен:

- найти все local operational button/chip/status implementations;
- классифицировать допустимые исключения;
- унифицировать остальное через shared primitives;
- не менять semantic priority CTA без product review;
- обновить screen source snapshot и visual/UI contracts.

### P1.3. Calculation registry coverage

Довести `CALCULATION-REGISTRY.md` до всех KPI, показываемых как управленческие цифры:

- Home/manager dashboard metrics;
- finance deviations;
- project progress;
- schedule lateness/variance;
- acceptance/rework;
- procurement attention;
- portfolio aggregation;
- reports.

Каждая формула обязана иметь source function/entities, units, null/empty behavior, rounding, time boundary, test and reconciliation rule.

### P1.4. Error/loading/offline consistency

Для critical screens унифицировать:

```text
loading
empty
error
retry
stale/offline
success/confirmed
provider pending/rejected/terminal
```

Raw runtime/provider diagnostics не попадают в user UI.

---

## P2 — maintainability and documentation automation

### P2.1. Автоматическая coverage-матрица ТЗ

Построить machine-readable registry:

```text
route/API/entity/calculation/screen
→ implementation sources
→ tests
→ documentation section
→ evidence workflow
```

Цель — видеть undocumented implementation и documented-but-untracked sections автоматически.

### P2.2. Schema change checklist

Любое изменение ORM Enum/Column/constraint требует:

- Alembic migration либо explicit reason migration not required;
- clean PostgreSQL proof;
- ORM/schema parity;
- current schema verifier update при новом invariant;
- technical-spec update;
- downstream restore/staging compatibility check.

### P2.3. UI token drift automation

Расширить текущие blob/token contracts до semantic shared components:

- PrimaryButton;
- StatusPill;
- InputField;
- hub tabs;
- cards;
- filter chips;
- error/empty/loading states.

---

# 4. Не считать завершённым без отдельного evidence

Даже после полного green local/CI нельзя автоматически объявлять:

- production infrastructure ready;
- реальные provider credentials/services verified;
- provider backups/PITR proven;
- production alert delivery proven;
- production RPO/RTO achieved;
- production mobile store delivery verified.

Эти статусы повышаются только retained staging/production evidence согласно `PRODUCTION-READINESS.md` и `docs/production-readiness-evidence.json`.
