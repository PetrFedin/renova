# Renova — Product Completion Mandate

**Статус:** ACTIVE — authoritative completion-task and acceptance catalogue.  
**Текущий execution order:** `PRODUCT-COMPLETION-BOARD.md` + `CHANGELOG-ROADMAP.md`.  
**Подчинение:** `AGENTS.md` остаётся authoritative engineering context. Этот документ задаёт обязательные задачи A1–E4 и их acceptance; Completion Board определяет *какой незакрытый контур делать следующим* на основании текущего `main`, exact-head evidence, новых P0 и dependency graph.  
**Цель:** довести продукт до состояния **полностью работающего end-to-end для заказчика и исполнителя на предусмотренных симуляторах провайдеров**, с архитектурой, в которую живые провайдеры подключаются адаптером без подмены доменной истины.  
**Критерий завершения:** все 8 golden paths из `GOLDEN-PATHS.md` зелёные в API- и mobile-web-E2E на canonical runtime, product-integrity blockers закрыты, а one-SHA exit gate из Completion Board выполнен.

### Execution-precedence rule

Acceptance из этого документа не ослабляется и task IDs не переопределяются. Однако старая фазовая последовательность **не имеет права обгонять более новый подтверждённый security/data/recovery/session/calculation blocker**.

Перед выбором задачи агент обязан:

1. прочитать `AGENTS.md`;
2. сверить current `main`, migration head, open P0/P1, PR heads/bases и CI;
3. прочитать `PRODUCT-COMPLETION-BOARD.md`;
4. только затем использовать этот mandate для scope/evidence конкретного A1–E4 task.

Если Board и этот документ расходятся по очередности, **Board управляет execution order, mandate управляет acceptance**. Если расходятся по требуемому продуктовому поведению — конфликт фиксируется в §9 и не решается молча.

---

## 1. Обязательные правила поведения агента

Эти правила действуют для каждого PR в рамках мандата и не могут быть ослаблены описанием задачи.

### 1.1. Ничего не удалять без доказательства

- Удаление файла, функции, класса, endpoint, route, миграции, теста, workflow, документа или поля модели допускается **только** при выполнении всех условий:
  1. repository-wide search показывает ноль внешних ссылок, либо каждая ссылка переведена на замену в том же PR;
  2. для кода есть замена, покрытая тестом того же поведения;
  3. для миграций удаление запрещено; только новая forward migration;
  4. тест удаляется только вместе с доказанным удалением/заменой проверяемого контракта;
  5. исторические документы архивируются вместо уничтожения, если сохраняют traceability.
- В описании PR обязателен `Removal proof` при наличии удалений.
- Если доказательства ненужности нет — не удалять; сохранить/пометить и создать issue.

### 1.2. Не ломать зелёное и не переиспользовать stale green

- Перед началом задачи фиксируется **текущий** baseline exact branch/main, а не историческое число passed.
- Если baseline красный до изменений — зафиксировать источник; не выдавать собственный PR за причину/решение чужого failure.
- После изменений выполнить применимые full/targeted/PostgreSQL checks.
- SQLite не заменяет PostgreSQL evidence для concurrency, locks, enum, migrations и DB authority.
- Необъяснимое уменьшение coverage/test count — blocker; легитимное изменение состава тестов требует traceability.
- После rebase/change SHA прошлый green является historical evidence exact старого SHA и не квалифицирует новый head.

### 1.3. Проверять от начала до конца, а не по месту правки

Для каждой затронутой сущности пройти цепочку:

`mobile/UI → api client → router → service → transaction/model/migration → outbox/storage/provider → worker → authoritative read → counterpart UI → retry/reversal/history`.

Разрыв цепочки — defect, даже если локальный unit test зелёный. Найденный defect вне bounded scope оформляется issue/Board row; не маскируется и не молча расширяет PR.

### 1.4. Размер и форма изменений

- Один PR = одна bounded задача/подзадача или один именованный blocker.
- Branch/PR naming следует `AGENTS.md` и текущему issue graph.
- В PR обязательны: `What`, `Why`, `Chain verified`, `Removal proof`, `Evidence`, `Out of scope / found issues`.
- Exact base/head SHA и applicability evidence обязательны.

### 1.5. Запрещено

- Подключать реальные ключи provider-ов или ослаблять production/staging policy.
- Расширять legacy writers вместо перевода в canonical service.
- Ослаблять tests/gates ради green.
- Переписывать assertion под текущее отображаемое значение без доказанного `STALE_CONTRACT`.
- Закрывать #300 foundation-PR-ом, если full scoped lifecycle не принят.
- Выдавать simulator/demo за real provider.
- Выдавать source inventory за E2E proof.
- Self-merge.

---

## 2. Приоритизация

Фазы A–E ниже — **структура acceptance backlog**, а не неизменяемая календарная очередь.

Текущий порядок выполнения вычисляется Completion Board по risk/dependency resolver:

`security/data/money corruption → atomicity/recovery → session/offline/cache → calculation truth → browser/native correctness → lifecycle/multi-party → usability → external readiness → new features`.

Если высшая задача ждёт owner/external action, агент берёт независимую задачу того же или более высокого класса риска; prerequisite не обходится.

| Фаза mandate | Acceptance purpose | Execution note |
|---|---|---|
| **A. Foundation** | Golden-path contracts, provider ports/simulators | Делать тогда, когда не нарушает более высокий текущий P0/DAG prerequisite. |
| **B. Product truth** | participant scope, legacy retirement, capacity/source truth | Security/data authority имеет высокий приоритет. |
| **C. Experience** | seed, dashboard, budget, schedule, documents, empty states/demo | UX не обгоняет integrity blocker и не скрывает его. |
| **D. End-to-end proof** | GP1–GP8 + negative/recovery | Финальный proof только на одном integrated SHA. |
| **E. Consolidation** | CI/docs/readiness | Не использовать consolidation для ослабления существующих gates. |

---

## 3. Определения

- **Port** — protocol внешней способности; domain зависит от порта, не provider-specific SDK.
- **Adapter** — реализация порта для конкретного provider-а.
- **Simulator** — контролируемая реализация полного provider lifecycle для test/local; запрещён как silent production substitute.
- **Contract test** — одинаковый behavior test для реализаций порта.
- **Golden path** — сквозной пользовательский сценарий из `GOLDEN-PATHS.md`.
- **Legacy writer** — mutation path, дублирующий canonical writer.
- **Exact evidence** — evidence, привязанное к конкретному SHA/runtime; не переносится автоматически после change/rebase.

---

## 4. Задачи

Формат сохранён для `scripts/governance/create-mandate-issues.py`: `ID · приоритет · описание` + scope + `Evidence:`.

### Фаза A — Foundation

**A1 · P0 · Golden paths как исполняемые контракты.**
Создать `e2e/golden/` с одним Playwright-файлом на каждый путь из `GOLDEN-PATHS.md` (API-уровень) и `apps/mobile/e2e/golden/` (mobile-web). Тесты пишутся по acceptance-критериям и должны честно падать там, где функционал не готов. Каждый тест помечается `@golden` и `@gp<N>`. В существующей CI topology должен быть явный golden-path gate; временная allow-fail политика допустима только пока это зафиксировано как незакрытый gate.
Evidence: список 8 GP с exact SHA/runtime и текущим pass/fail + причиной каждого fail.

**A2 · P0 · Порты провайдеров.**
Добавить/довести `backend/app/services/providers/` (`base.py`, `registry.py`, `errors.py`) без изменения продуктовой семантики. Existing providers мигрируют bounded-проходами, не big-bang refactor.
Evidence: provider contract tests зелёные на exact candidate; no direct provider bypass introduced.

**A3 · P0 · Симулятор платежей.**
Довести simulated payment lifecycle: `create → pending → (succeed | cancel) → refund`, через тот же domain/webhook processing path, что adapter contract. Симулятор должен переживать restart необходимого runtime и быть controllable из test/dev только fail-closed вне разрешённых environment.
Evidence: contract test simulated + GP5 relevant slice; persisted domain/outbox/Expense truth сходится без двойного recognition.

**A4 · P0 · Миграция платежей на порт.**
Перевести прямые provider-specific calls payment/subscription/admin/portal/readiness на provider registry/port. Provider-specific code остаётся в adapter; compatibility re-export допускается только как явный temporary bridge.
Evidence: repository search показывает только допустимые adapter/re-export references; payment/subscription tests зелёные без подгонки expected values.

**A5 · P0 · Симулятор ФНС-чеков и статуса НПД.**
Simulated fiscal/NPD должен поддерживать детерминированные valid/not_found/mismatch/timeout/rate-limit/active/inactive/unknown outcomes через provider port, а не demo shortcut.
Evidence: provider contracts + affected GP5/GP6 receipt/status slices.

**A6 · P1 · Симуляторы уведомлений и подписи.**
SMS/push/e-sign simulated paths должны быть inspectable/replayable и использовать те же domain boundaries, что real adapters. E-sign simulation не называется юридически эквивалентной real qualified signature.
Evidence: GP8 OTP/push simulated slice; e-sign contract path; exact persisted message/receipt evidence.

**A7 · P1 · Режимы провайдеров в settings и runtime policy.**
Единая semantic model `off | simulated | real`; simulated fail-closed in staging/production unless explicitly approved test environment; real without required credentials fails preflight. Health/readiness отражают фактический mode.
Evidence: runtime/preflight integrity + provider mode matrix.

### Фаза B — Product truth (#300 и legacy)

**B1 · P0 · Scoped participant visibility.**
Все relevant read/write пути проекта должны применять `ProjectParticipant.scope`. Исполнитель видит и мутирует только свой scope; заказчик — разрешённую aggregate truth. Sibling contractor negative tests обязательны.
Evidence: PostgreSQL participant integrity + GP2/GP3 with two independent contractors.

**B2 · P0 · Mobile participant UX.**
Заказчик управляет участниками/scope/status; исполнитель видит назначенные project/scope; direct/marketplace conversion заканчивается canonical participant truth; routes только через registry.
Evidence: mobile-web GP2 + typecheck/navigation + sibling role scenarios.

**B3 · P0 · Retire legacy writers.**
Legacy project/budget/mobile writers переводятся на canonical writers. Удаление только после repository-wide proof и behavioral replacement.
Evidence: Removal proof + unchanged relevant business expectations.

**B4 · P1 · Contractor capacity policy.**
Capacity проверяется атомарно при create/assign/conversion/quote acceptance. Concurrent operations не могут oversubscribe ограниченный resource.
Evidence: PostgreSQL race with capacity=1 gives exactly one success.

**B5 · P1 · Marketplace source transitions.**
JobLead writers сходятся в одной transition authority с row/version locking и явной transition table.
Evidence: PostgreSQL race + GP2 negative path.

### Фаза C — Experience

**C1 · P0 · Realistic seed.**
Deterministic realistic seed создаёт насыщенный mid-life project и near-closeout state с rooms, estimate, stages, participants, payments/evidence, materials/purchases, schedule, chat, issue/warranty/change. Повторный seed не дублирует. Финансовые facts сходятся по authoritative formulas.
Evidence: seed integrity + double-seed idempotency + exact expected counts/amounts.

**C2 · P0 · Дашборд заказчика.**
Главная показывает статус, нужные решения, ближайшие события, plan/fact/forecast и главный риск с deep-link в canonical detail. Не перегружать advanced analytics основным пользовательским flow.
Evidence: mobile-web exact data from C1 + browser/accessibility state.

**C3 · P0 · Бюджет: план → смета → факт → отклонение.**
Budget UI и API сохраняют различие plan/revised/obligation/actual/cash/forecast; category/record/evidence drill-down. Contractor projection соблюдает participant scope.
Evidence: numbers reconcile with calculation registry/seed; GP1/GP5 relevant mobile-web.

**C4 · P1 · График работ.**
Schedule показывает этапы/dependencies/critical delay truth и causal blocker; календарь остаётся canonical schedule access point.
Evidence: GP3 mobile-web + calendar integrity.

**C5 · P1 · Приёмка и гарантия в UI.**
Полный flow `submit → accept/return → rework → confirm fix → close → warranty claim → warranty closure`, включая evidence/portal authority.
Evidence: GP4 API + mobile-web + PostgreSQL warranty/supervision integrity.

**C6 · P1 · Документы.**
Document hub можно структурно декомпозировать без изменения поведения; lifecycle version → sign → status → authenticated export/archive. Native file outcome остаётся отдельным acceptance.
Evidence: GP7 + document tests + structural removal/behavior proof.

**C7 · P1 · Empty states и первый запуск.**
Первый запуск обеих ролей на clean DB даёт осмысленный one-next-action empty state, ведущий в canonical GP, без demo-only shortcut.
Evidence: customer + contractor clean-start mobile-web E2E.

**C8 · P1 · Web-демо-стенд.**
Reproducible review/demo build использует deterministic seed и явные demo/provider modes. Public deployment, если существует, оценивается отдельно deployed smoke и не становится product-complete доказательством автоматически.
Evidence: reproducible build + role entry + full browser contract; known browser failures остаются blocker до исправления.

### Фаза D — End-to-end proof

**D1 · P0 · Все 8 golden paths зелёные (API + mobile-web).**
GP1–GP8 проходят на одном exact integrated SHA на canonical PostgreSQL + Redis + MinIO + API + Worker с предусмотренными simulated providers.
Evidence: one-SHA golden-path job/result matrix без allow-fail для финального candidate.

**D2 · P0 · Negative paths.**
Для каждого GP минимум два релевантных отрицательных сценария плюс обязательные ACL/session/offline/concurrency cases по Completion Board.
Evidence: exact negative matrix linked to GP IDs.

**D3 · P1 · Recovery paths.**
Duplicate/early/mismatched provider events, worker crash, response loss, restart и reconciliation сходятся к одному authoritative state без двойных business effects.
Evidence: PostgreSQL/worker/provider recovery tests + GP recovery scenarios.

### Фаза E — Consolidation

**E1 · P1 · CI matrix.**
Consolidation workflow-ов допускается только с one-to-one mapping существующих checks и без уменьшения mandatory coverage. Не создавать новый workflow только ради обхода существующего governance.
Evidence: old-check → new-job mapping + exact green candidate.

**E2 · P1 · Docs archive.**
Historical audit/merge/fix docs архивируются с `HISTORICAL`; current master/Board/roadmap остаются однозначными.
Evidence: no broken authoritative links; historical docs не используются как current readiness.

**E3 · P0 · Readiness truth.**
`PRODUCTION-READINESS.md` и machine evidence показывают фактический product completeness/provider modes/external blockers и exact SHA.
Evidence: readiness integrity + agreement with migration head and Completion Board final verdict.

**E4 · P2 · LICENSE.**
Добавить/уточнить repository LICENSE только по решению владельца; до решения не придумывать лицензию.
Evidence: owner-approved license text or explicit retained status.

---

## 5. Definition of Done

PR по mandate task готов, когда:

1. Task ID/scope указан; PR bounded.
2. `Chain verified` содержит реальную affected path.
3. `Removal proof` присутствует при удалении.
4. Applicable focused/full/PostgreSQL/browser/native checks зелёные либо внешний blocker явно зафиксирован.
5. Exact SHA/run записаны; stale old-head evidence не переиспользуется.
6. Golden Path/Board status обновлён только если actual evidence изменился.
7. Found out-of-scope defect оформлен issue/Board entry.
8. Provider mode/readiness truth не ослаблена.
9. Mobile typecheck/navigation/accessibility применимо проверены.
10. No self-merge; owner/required reviewer принимает интеграцию.

---

## 6. Порядок работы одного агента над задачей

1. Прочитать `AGENTS.md` → `PRODUCT-COMPLETION-BOARD.md` → master spec → roadmap → этот mandate → Golden Paths → domain contract.
2. Сверить main/migration/issues/PR heads/CI/deployed evidence.
3. Выбрать highest-priority available bounded blocker по Board; только затем сопоставить его с mandate ID/acceptance.
4. Зафиксировать current baseline.
5. Пройти affected chain и сформулировать failing contract/test.
6. Реализовать минимальный bounded fix без соседнего scope creep.
7. Прогнать exact applicable tests и persisted outcome checks.
8. Обновить spec/Board/roadmap при изменении status/order.
9. Открыть/обновить PR с exact evidence. Не мержить самостоятельно.

---

## 7. Ревью вторым агентом/владельцем

Для P0, deletion, security/data/recovery и других governed PR ревью проверяет:

- evidence воспроизводимо на exact candidate?
- removal proof корректен?
- chain действительно замкнута?
- нет нового legacy/provider bypass?
- новая проблема не замаскирована test rewrite?
- какой adjacent failure наиболее вероятен и был ли проверен?
- не используется ли stale base/green?

Вердикт и evidence остаются в PR. Merge выполняется только после required review/policy.

---

## 8. Что мандат явно НЕ делает автоматически

Следующие области требуют отдельной фактической внешней qualification и могут оставаться `FUTURE EXTERNAL` после internal product completeness:

- persistent staging/exact artifact promotion;
- production/main administrative protection evidence;
- managed backup/PITR/DR;
- external observability alert delivery/ACK;
- load/capacity;
- independent pentest/security acceptance;
- живые provider credentials/transactions;
- TestFlight/App Store distribution;
- legal/privacy approval;
- controlled production pilot.

Репозиторный CI не закрывает эти внешние факты.

---

## 9. Журнал конфликтов и решений

| Дата | Конфликт | Решение | Кто |
|---|---|---|---|
| 2026-09-16 | Старый mandate объявлял фиксированный фазовый порядок и исторический baseline, тогда как к этому времени появился новый P0 dependency graph и множество stacked exact-head candidates. | Acceptance A1–E4 сохранён; current execution order передан `PRODUCT-COMPLETION-BOARD.md`; baseline всегда берётся с текущего exact SHA. | governance reconciliation |

Агент, обнаруживший новый конфликт между mandate, `AGENTS.md`, Board и кодом, обязан обновить этот журнал или создать governance issue. Если конфликт меняет продуктовое поведение/authority, он не решается молча.
