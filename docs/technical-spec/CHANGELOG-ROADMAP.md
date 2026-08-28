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
4. `create_work_order()` создаёт domain-owned thread `work:<work_order_id>` и сохраняет FK в `work_orders.chat_thread_id`.
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

После появления `w17` этот evidence остаётся исторически полезным, но current final candidate должен пройти повторную exact-head проверку.

---

# 3. Приоритизированный roadmap

Roadmap не является списком пожеланий. Работу ведём сверху вниз; следующий пункт берётся только после повторного чтения master dossier, этого annex и текущего CI/evidence.

## P0 — release/runtime correctness

### P0.1. Закрыть canonical local runtime end-to-end

**Gate:** `Canonical local runtime integrity = success` на exact final SHA после `w17` и seed-lifecycle changes.

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

**Gate:** enhanced `verify_orm_schema_parity.py` на clean PostgreSQL.

Если generic verifier выявит дополнительные enum mismatches, каждый mismatch:

1. классифицируется по migration history;
2. исправляется отдельной fail-closed migration/invariant;
3. документируется в master dossier;
4. проходит upgrade/downgrade/replay где downgrade семантически безопасен.

Не допускается ослаблять verifier ради зелёного CI.

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
