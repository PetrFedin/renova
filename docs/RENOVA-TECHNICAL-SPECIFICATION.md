# Renova — живое техническое задание и системная спецификация

**Статус документа:** ACTIVE / LIVING SPECIFICATION  
**Язык:** русский  
**Дата текущей полной сверки:** 2026-09-16  
**Канонический `main` на момент сверки:** `e5c6ee44c0f684b14037e77948dbcb630fd41896`  
**Текущий schema head в этой редакции:** `w22projectparticipants01`  
**Текущий verification status:** `MAIN PARTIAL / BOUNDED CANDIDATE EVIDENCE ACTIVE / FULL PRODUCT ACCEPTANCE BLOCKED`  
**Широкий production-запуск:** `BLOCKED_FOR_BROAD_PRODUCTION`

`AGENTS.md` — authoritative engineering policy. Этот master — паспорт продукта и системный контракт. **Текущий операционный статус, exact-candidate evidence и порядок интеграции определяются `technical-spec/PRODUCT-COMPLETION-BOARD.md`.** `PRODUCT-COMPLETION-MANDATE.md` остаётся каталогом мандатных задач A1–E4 и их acceptance; его историческая фазовая последовательность не отменяет более новый подтверждённый P0/dependency-DAG из Completion Board.

Предыдущая полная редакция до 2026-09-08 сохранена в `technical-spec/history/RENOVA-TECHNICAL-SPECIFICATION-before-2026-09-08.md`. Исторический документ не используется как current readiness/next-step verdict.

Актуальные приложения:
- `technical-spec/PRODUCT-COMPLETION-BOARD.md` — **что уже доказано и что делать следующим**;
- `technical-spec/CHANGELOG-ROADMAP.md` — интеграционный порядок и журнал;
- `technical-spec/GOLDEN-PATHS.md` — GP1–GP8;
- `technical-spec/PRODUCT-COMPLETION-MANDATE.md` — каталог completion tasks/acceptance;
- `technical-spec/CALCULATION-REGISTRY.md` — формулы и источники;
- `technical-spec/SCREEN-CONTRACT-CATALOG.md` — экраны/состояния;
- `technical-spec/SCREEN-SOURCE-SNAPSHOT.md` — machine-bound source snapshot;
- `technical-spec/END-TO-END-GOVERNANCE.md` — правила сопровождения и пересчёта приоритета;
- `PRODUCT-COMPLETENESS-AUDIT-2026-09-08.md` — базовый аудит; новые findings ведутся через Board/issues/PR evidence.

---

# 0. Главный продуктовый принцип

RENOVA должна быть не набором функций, а доказанным сквозным продуктом:

`создал → увидел authoritative state → изменил → другая сторона увидела → пересчиталось → согласовал/отклонил → ошибся/отменил → восстановил → потерял сеть/ответ → безопасно повторил → сменил аккаунт/проект → ничего чужого не утекло → завершил объект → получил историю, документы и гарантию`.

Единица готовности — **законченный пользовательский результат**, а не файл, экран, route или issue.

## 0.1. Единственные статусы готовности

Используются только:

- `PROVEN` — интегрировано и доказано на canonical exact SHA;
- `CANDIDATE PROVEN` — доказано на bounded exact candidate, не на `main`;
- `PARTIAL` — часть цепочки существует/проверена;
- `BLOCKED` — есть конкретный blocker/prerequisite;
- `FUTURE EXTERNAL` — требуется внешняя production/provider/device/admin evidence.

`VERIFIED SOURCE` и `CI GREEN` сами по себе не эквивалентны `PROVEN` пользовательского результата.

## 0.2. Evidence hierarchy

При расхождении источников приоритет истины:

1. наблюдаемый runtime/deployed behavior;
2. exact-head CI + persisted DB/storage evidence;
3. current code/router/migrations;
4. machine-readable readiness;
5. living specification;
6. historical docs/chat assumptions.

Документ никогда не используется для повышения статуса вопреки runtime evidence.

## 0.3. Обязательная синхронизация перед любой новой задачей

Проверить:

1. `main` SHA;
2. Alembic head;
3. открытые P0/P1 issues;
4. active/draft/stacked PR и exact heads;
5. применимые CI/deployed runs;
6. `PRODUCTION-READINESS.md`;
7. Completion Board;
8. master-ТЗ;
9. roadmap;
10. domain/calculation/screen contracts.

После изменения behavior/evidence/status обновлять spec/Board в той же logical change. Новый подтверждённый P0 автоматически имеет приоритет над прежним P1/UX планом.

---

# 1. Назначение продукта

RENOVA — iPhone-first, но не iPhone-only, система управления реальным ремонтом для заказчика, исполнителей и связанных ролей.

Целевой пользовательский результат:

- объект и исходные данные;
- понятная смета и история изменений;
- этапы, задачи, зависимости и график;
- подбор, согласование, закупка и поставка материалов;
- подтверждённые расходы, платежи, чеки и прогноз;
- коммуникация, решения и уведомления;
- приёмка, замечания, исправления и технадзор;
- документы и версии;
- завершение ремонта;
- архив истории;
- гарантийный lifecycle.

Система обязана сохранять правильность при timeout, response loss, retry, offline, restart, concurrency, revocation, смене project/account и отказах внешних provider-ов.

---

# 2. Роли и режимы

Основные роли:

- customer;
- contractor principal;
- contractor team member;
- viewer/guest;
- technical supervisor;
- portal-token actor;
- admin/operator.

Роль сама по себе не даёт права вне project/resource scope. `Project.contractor_id` — compatibility lead, а не полная модель участников. Целевой multi-contractor authority строится через `ProjectParticipant`/scope и остаётся незавершённым до закрытия #300/#344/#345.

Completion Board ведёт режимы M01–M12:

- self-managed;
- one contractor;
- multi-contractor;
- contractor team;
- direct invite;
- marketplace;
- technical supervision;
- viewer;
- portal-token;
- closed/warranty;
- unstable network;
- account switch.

Ни один режим сейчас не считается полностью `PROVEN`.

---

# 3. Репозиторий и source of truth

Канон: `PetrFedin/renova` → `main` → bounded branch → PR → exact-head applicable checks → owner review/merge → descendants rebase/requalify.

Нельзя использовать старую feature/develop branch как новую интеграционную базу только потому, что на ней больше функций.

Авторитетные уровни:

- navigation — `routeRegistry` + реальные Expo routes;
- API — итоговая router composition + canonical service;
- data — ORM + линейный Alembic + PostgreSQL;
- async — DomainOutbox + worker;
- cache/coordination — Redis по явному контракту;
- private files — S3-compatible/MinIO с object authority;
- money — явные plan/obligation/actual/payment/evidence/refund concepts;
- readiness — `PRODUCTION-READINESS.md` + machine evidence;
- execution order — Completion Board.

### Schema truth

Canonical `main` на этом срезе: `w22projectparticipants01`.

PR #457 квалифицировался на отдельной composition base с candidate head `w23estimatelifecycle01`. Это **candidate schema evidence**, а не текущий schema head `main`; до merge/requalification он не должен появляться как current master head.

---

# 4. Runtime architecture

Целевая topology:

- PostgreSQL — authoritative business data;
- Redis — coordination/rate limit/cache/queue-related shared state по конкретным контрактам;
- MinIO/S3 — private media/documents;
- API — HTTP/WebSocket и синхронные commands/reads;
- Worker — durable outbox/provider/reconciliation/automation/push work.

Один immutable backend image должен использоваться для соответствующих runtime roles. API replica заменяема без потери committed business truth.

Canonical local runtime должен поднимать PostgreSQL + Redis + MinIO + migrations/preflight + API + Worker; local success не называется staging/production success.

На текущем integration path:

- #425 — bootstrap/required-check/local runtime prerequisite;
- #389 — backend image PCRE2 remediation candidate;
- #372 — npm remediation candidate;
- #437 — required context scheduling candidate;
- #450 — bounded registry retry candidate.

Они являются bounded candidate evidence и требуют интеграции/requalification в порядке Completion Board.

---

# 5. Data/domain model

| Контур | Основные сущности | Неподменяемая истина |
|---|---|---|
| Identity | User, AuthSession | actor/session generation и revocation |
| Object | Project, Room, FloorPlan, DesignPackage | что именно ремонтируется |
| Participation | ProjectParticipant, scopes/events | кто и в какой области имеет authority |
| Estimate | EstimateLine, revisions, ChangeOrder | коммерческий план и утверждённые изменения |
| Execution | Stage, WorkOrder, schedule/dependency | planned/started/done/accepted различны |
| Procurement | Selection, MaterialPick, Purchase, PurchaseItem, Receipt | выбор, ответственность, заказ, поставка, доказательство различны |
| Finance | Budget, Expense, Payment, evidence, Refund/Dispute | план, факт, деньги и документ не подменяются |
| Communication | Thread, Message, Read, notification/inbox | context/visibility/read truth |
| Quality | Acceptance, Issue, Rework, supervision | сдача ≠ приёмка; исправлено ≠ подтверждено |
| Documents | ProjectDocument/version/signature/export | версия/подпись/retention |
| Reliability | ClientWriteRequest, DomainOutbox, provider operation | exactly-once intent/recovery |
| Lifecycle | archive/trash/restore/purge/closeout/warranty | логическое состояние ≠ физическое удаление |

Любая новая durable entity обязана входить в ACL, export/retention/purge, backup/restore и history/evidence contracts.

---

# 6. Transaction, idempotency, recovery

Целевой invariant одной бизнес-операции:

`authoritative mutation + request identity/version fence + audit + required outbox effects` фиксируются атомарно там, где относятся к одному business command.

### Client intent

- `client_request_id` создаётся **до первой сетевой попытки**;
- exact serialized intent сохраняется для replay;
- same key + same canonical payload → исходный результат;
- same key + changed payload → typed conflict;
- две осознанные одинаковые операции имеют разные identity.

### Commit acknowledgement

Нельзя объединять в один catch:

1. authoritative commit;
2. subsequent refresh/sync;
3. navigation/UI reconciliation.

Если commit подтверждён, а refresh упал, UI сообщает:

> Сохранено. Не удалось обновить экран.

а не «не сохранено».

### Current recovery truth

#322, #414, #416, #418/#459, #460/#465 и ряд других PR дают сильные bounded replay primitives. Но #316 как family-wide проблема остаётся открытой. #383/#392/#404/#412 всё ещё не имеют достаточной integrated comparable qualification. #315/#317 остаются cross-cutting blockers.

---

# 7. Session/account/offline truth

## 7.1. Session generation — #315

Обязательная защита охватывает:

- request start/completion;
- refresh token;
- storage writes;
- project selection;
- cache publication;
- Inbox/domain publication;
- offline queue flush;
- navigation;
- files/download results.

Обязательные сценарии:

- A request → logout → B → late A response;
- A1 → B → A2: старый A1 generation не принадлежит A2;
- Project 1 → Project 2 → delayed Project 1 response;
- token refresh старой session;
- queued A intent при B.

#428 доказывает только server-side logout revoke primitive; это не закрывает #315.

## 7.2. Offline/cache — #317

Различать:

- authoritative business refusal;
- response ambiguity;
- timeout/network;
- cancel;
- stale cache;
- conflict.

UI states:

- `Сохранено`;
- `Отправится автоматически`;
- `Требует проверки`;
- `Конфликт`.

Cache имеет source/as-of; перечитывание старого cache не превращает его в fresh.

---

# 8. Security and object authority

Fail-closed ACL должен связывать child object с уже авторизованным project/thread до чтения или mutation.

Текущие bounded security candidates включают:

- #444 estimate-line path/project binding;
- #424 calendar stage/project binding;
- #452 stage reaction Project→Stage→Comment binding;
- #455 project-media ACL;
- #456 chat attachment/thread ACL;
- #441 floor-plan/pin/furniture binding остаётся PARTIAL до полного требуемого PostgreSQL proof/integration.

Финальная acceptance требует sibling/cross-project negatives для estimate/media/documents/finance/chat/materials/work/schedule и cross-account session boundaries.

Private bytes обязаны наследовать current authority бизнес-объекта, а не быть доступны по знанию storage key.

---

# 9. Financial and calculation truth

Раздельные authoritative понятия:

- customer maximum budget;
- estimate / revised plan;
- committed obligation;
- actual recognized expense;
- cash/payment state;
- forecast to completion;
- receipt/evidence;
- refund/dispute;
- unknown.

Unknown нельзя сохранять/показывать как 0 или как `actual = plan`.

#382 имеет strong bounded evidence для:

- sum-preserving period allocation;
- local calendar/as-of logic;
- unavailable category actual вместо fabricated zero variance.

Это не закрывает GP5 и весь finance lifecycle.

Любая важная сумма UI должна иметь drill-down:

`summary → category → record → authoritative source/evidence`.

---

# 10. Основные продуктовые цепочки

## 10.1. Новый объект

Customer → основные параметры → комнаты → ориентировочная/рабочая смета → invite/contractor → обе стороны видят один canonical project.

Wizard не должен ставить десятки advanced inputs между пользователем и созданием. После create показывается readiness, а не случайный набор tools.

## 10.2. Смета и Дополнительные работы

Contractor edit → proposal → customer sees delta → approve/reject → fixed version → budget/forecast/history reconcile.

User-facing `Change Order` = **Дополнительные работы**.

#448 bounded-proves Change Order terminal conflict/replay/linked budget-document behavior. #457 bounded-proves reversible estimate-line removal/restore on candidate schema. Full GP1 #458 ещё не квалифицирован.

## 10.3. Работы

Stage = крупный принимаемый блок. Task/WorkOrder = конкретная работа внутри этапа.

Stage становится aggregate context:

- progress;
- tasks;
- schedule;
- materials;
- money;
- photos/documents;
- issues;
- next action.

Stage start — явный business event. Material readiness не стартует этап автоматически.

## 10.4. Материалы

Human lifecycle:

`Нужно → Согласовано → Заказано → Доставлено`.

**Approved не равно Ordered.**

Пользователь должен понимать:

- сколько требуется;
- сколько уже доступно;
- сколько купить;
- кто покупает;
- лимит/дельту бюджета;
- поставку/receipt.

#460/#465 bounded-proves material-needs replay primitive; procurement/delivery/return/expense lifecycle остаётся шире.

## 10.5. Деньги

Invoice/request не является Payment. Payment не становится Expense без канонического recognition event. Receipt не должен второй раз увеличивать расход, уже признанный другим authoritative путем.

## 10.6. Chat and Inbox

**Chat — context, не источник business truth.**

Сообщение может создать/link Task, Invoice, Допработу или Issue, но canonical entity живёт отдельно и доступна из чата по ссылке.

Inbox — единый attention center:

- customer: `Нужно решить`;
- contractor: `Задачи и решения`.

Approvals — detail flow, а не второй конкурирующий центр.

## 10.7. Приёмка

Contractor: `Сдать этап`.  
Customer: `Принять` или `Вернуть на доработку`.  
Contractor: `Исправлено`.  
Customer: `Подтвердить исправление`.

Issue содержит location/stage/before/description/owner/due/status/after/history.

## 10.8. Завершение и гарантия

Closeout checklist:

- accepted work;
- no blocking issues;
- required money state;
- documents;
- warranty readiness.

После closeout активные renovation CTA исчезают; Home становится итоговой страницей объекта с cost/duration/report/documents/history/warranty.

Warranty Claim — одна canonical entity для обеих ролей с разными allowed actions.

#319 остаётся blocker для permanent purge/retention/full graph.

---

# 11. Mobile information architecture

Цель — стабильная карта, а не phase-driven перестановка navigation.

Canonical concepts:

- Главная;
- Объект;
- Работы/Ремонт;
- Сроки;
- Деньги;
- Сообщения.

При ограничении Dock до пяти destinations позиция должна быть предсказуемой; Schedule остаётся prominent и не теряется как второстепенный смысл.

## Object

- Комнаты;
- Смета;
- **Чертежи и дизайн** вместо неоднозначного `План`;
- Данные объекта.

## Repair

- Этапы;
- Приёмка;
- Материалы;
- Выбор материалов.

## Budget

Customer labels:

- План–факт;
- Расходы;
- Оплаты;
- Отклонения.

Contractor labels могут различаться по полномочиям, но underlying truth одна.

## Schedule

- Сегодня;
- 2 недели;
- Весь ремонт.

Delay объясняет причину: материал, dependency, решение заказчика и т.п.

---

# 12. Home contracts

## Customer Home

За ~5 секунд отвечает:

1. где ремонт сейчас;
2. что требуется от заказчика;
3. что произойдёт в ближайшие 7 дней;
4. план/факт/forecast;
5. главный риск/блокер.

## Contractor Home

Показывает:

- Сегодня;
- Просрочено;
- Заблокировано;
- Ждёт заказчика;
- Готово к сдаче;
- Деньги/поступления в релевантном scope.

Advanced manager/report tools не должны вытеснять основные ежедневные действия.

---

# 13. UX outcome contract

Каждый важный object/card/action отвечает:

`Статус → Ответственный → Следующее действие → Срок → Финансовое/сроковое влияние → История`.

Правила:

- одно визуально главное действие;
- full action names (`Принять этап`, а не `Подтвердить`);
- progressive disclosure;
- hidden long-press не основной discoverability path;
- destructive action показывает consequence;
- commit outcome отдельно от refresh;
- loading/empty/error/stale/conflict/offline/success различны;
- internal enum/provider jargon не показывается пользователю без необходимости;
- external capability явно `Подключено / Тестовый режим / Не подключено / Недоступно`.

---

# 14. Accessibility and browser navigation

Минимум:

- 44×44 touch target;
- focus order;
- screen reader labels;
- `aria-selected`/roles;
- keyboard on web;
- modal focus and cleanup;
- disabled/busy semantics;
- back/canonical parent;
- status not by color only;
- reduced motion;
- long Russian copy/text scaling;
- iOS/Android safe area.

Deployed run `35084701908` доказал, что этот gate ещё не закрыт: overlay блокировал dock, tab selected semantics нарушались, customer/contractor navigation имела несколько failures. Поэтому accessibility/navigation сейчас — correctness gate, а не косметика.

---

# 15. Documents and files

User-facing structure:

1. Проект;
2. Финансы;
3. Приёмка и гарантия;
4. Архив.

1С/bank/iCal/technical export → `Экспорт и интеграции`.

#320 закрывается только при authenticated file outcome на web/iOS/Android с:

- current session fence;
- actual bytes/content;
- native save/share;
- cancellation;
- cleanup;
- error state;
- revoked ACL.

Metadata classification не называется OCR содержимого. In-app signature не называется автоматически юридически равной внешней квалифицированной подписи.

---

# 16. Provider boundary

Внешняя capability работает через port/adapter/simulator, а domain code не должен зависеть от конкретного provider-а.

Internal product-complete допускает simulated providers там, где это закреплено GP/mandate. Production/staging не должны silently использовать simulator.

#426 bounded-proves simulated fiscal/NPD capability. Payment simulator A3/A4 и остальные required simulated lifecycles должны пройти GP path. Real YooKassa/FNS/NPD/Kontur/Goskey/SMS/e-sign — отдельная external qualification.

---

# 17. Review/demo environment

Public review stand используется для product inspection, но не заменяет canonical local/runtime acceptance.

Последняя проверенная deployed evidence:

- role/project entry: проходит 4/4;
- mutation/recovery deployed proof: SUCCESS;
- Chromium product smoke: 4/10 pass, 6 fail;
- WebKit product smoke: FAIL.

Известные browser blockers ведутся в Completion Board. Пока они есть, стенд нельзя описывать как «всё работает».

Review seed должен быть deterministic и включать минимум:

- active project с estimate/change/stages/materials/purchase/receipt/payment/chat/acceptance/issue/docs;
- near-closeout project с acceptance/final money/closeout/warranty/history.

Demo provider state никогда не выдаётся за production state.

---

# 18. Tests and acceptance

Тип evidence и его предел:

| Evidence | Доказывает | Не доказывает |
|---|---|---|
| Source/static contract | structure/invariant exists | runtime result |
| Unit/service | bounded branches | full role/device lifecycle |
| PostgreSQL integrity | real DB lock/constraint/migration scenario | unrelated writers/production load |
| API E2E | HTTP + DB result | usable UI/native result |
| Browser E2E | rendered/navigation user path | native device/provider unless exercised |
| Native acceptance | concrete build/device path | every future build |
| External drill | exact environment/provider operation | permanent readiness |

### GP1–GP8

Существующие Golden Paths остаются обязательным final gate. GP нельзя повысить по отдельному component PR.

### Adversarial matrix

Для применимого critical mutation:

- normal;
- validation error;
- ACL denial;
- stale data;
- offline before send;
- timeout/ambiguous response;
- commit + lost response;
- same-intent retry;
- changed payload conflict;
- double tap;
- competing update;
- revoke while waiting;
- A→B→A;
- restart;
- cancel/reversal;
- archive/restore;
- durable history/evidence.

---

# 19. Текущий приоритетный порядок

Полный dependency DAG ведётся в Completion Board. На текущем evidence cut:

### P0 — integration foundation

1. owner review/merge #425;
2. rebase/requalify #389/#372/#437/#450;
3. live ruleset/protection #247.

### P0 — security/data truth

4. project/child authority: #444/#424/#452/#441;
5. media ACL: #455→#456;
6. finance truth #381/#382 и affected producers;
7. sibling/cross-project scans.

### P0 — replay/recovery

8. #322 integrate/requalify;
9. its mutation children; #316 executable inventory to zero unsafe reachable writes;
10. #461 after prerequisites.

### P0 — global session/offline

11. #315;
12. #317;
13. G04/G05-like account/offline matrix.

### P0/P1 — first connected GP

14. project/room/estimate/change/budget integration;
15. rebuild/qualify #458 GP1.

### P1 — multi-contractor and lifecycle

16. #300/#344/#345/#429;
17. GP2/GP3;
18. #319;
19. #320;
20. closeout/warranty/history.

### P1 — Human Usability Closure

21. Customer/Contractor Home;
22. stable navigation;
23. estimate/stage/materials/schedule/inbox/documents simplification;
24. accessibility;
25. role-by-role friction retirement.

### Final internal acceptance

26. GP1–GP8 one SHA;
27. browser/native matrix;
28. concurrency/offline/reversal/account switch;
29. immutable release evidence pack.

### FUTURE EXTERNAL

30. staging/artifact promotion;
31. managed DR;
32. observability;
33. load;
34. independent security/legal/privacy;
35. real providers;
36. pilot/operations.

Новые крупные features, dashboards, AI flows или integrations не имеют приоритета над этой closure queue без отдельного решения владельца.

---

# 20. Final Definition of Done

RENOVA может называться готовой внутренне только если на одном immutable candidate:

- launch-blocking P0 = 0;
- GP1–GP8 `PROVEN`;
- critical mutation inventory closed;
- customer+contractor browser matrix green;
- required native paths green;
- session/account isolation proven;
- offline/retry/reversal proven;
- financial/calculation reconciliation proven;
- multi-contractor isolation proven;
- project/media/document ACL proven;
- migrations and restore evidence proven;
- closeout/archive/warranty/history proven;
- review data deterministic;
- external unavailable functions честно остаются `FUTURE EXTERNAL`.

После любого изменения exact SHA affected evidence пересчитывается. **Старый green не является сертификатом нового кода.**

Документ считается актуальным только вместе с `PRODUCT-COMPLETION-BOARD.md`; если их статусы расходятся, до reconciliation используется более консервативный фактически доказанный статус.
