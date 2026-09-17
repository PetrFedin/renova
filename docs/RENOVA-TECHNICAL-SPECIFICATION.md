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
- `technical-spec/SCREEN-SOURCE-SNAPSHOT.md` — machine-bound screen source snapshot;
- `technical-spec/END-TO-END-GOVERNANCE.md` — правила сопровождения и пересчёта приоритета;
- `technical-spec/PRODUCT-COMPLETENESS-AUDIT-2026-09-08.md` — базовый аудит; новые findings ведутся через Board/issues/PR evidence.

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

**VERIFIED** означает подтверждение заявленного source/contract, но не автоматически полный пользовательский результат. **PENDING REVERIFY** означает, что SHA/base изменился после предыдущего evidence. **TBD / UNVERIFIED** означает отсутствие достаточного доказательства. Эти термины не повышают readiness выше фактического Board status.

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

# 1. Назначение продукта и границы системы

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

# 3. Runtime architecture

Целевая topology:

- PostgreSQL — authoritative business data;
- Redis — coordination/rate limit/cache/queue-related shared state по конкретным контрактам;
- MinIO/S3 — private media/documents;
- API — HTTP/WebSocket и синхронные commands/reads;
- Worker — durable outbox/provider/reconciliation/automation/push work.

Один immutable backend image должен использоваться для соответствующих runtime roles. API replica заменяема без потери committed business truth.

Canonical local runtime — Compose project `renova-local`. Он должен поднимать PostgreSQL + Redis + MinIO + migrations/preflight + API + Worker; local success не называется staging/production success.

Основные локальные команды остаются частью engineering contract:

```bash
npm run dev -- doctor
npm run dev -- bootstrap
RENOVA_DEV_NO_EXPO=1 npm run dev
npm run dev -- check
npm run dev -- seed
npm run dev -- test-focused
npm run dev -- test-full
npm run dev -- logs
npm run dev -- stop
```

На текущем integration path:

- #425 — bootstrap/required-check/local runtime prerequisite;
- #389 — backend image PCRE2 remediation candidate;
- #372 — npm remediation candidate;
- #437 — required context scheduling candidate;
- #450 — bounded registry retry candidate.

Они являются bounded candidate evidence и требуют интеграции/requalification в порядке Completion Board.

---

# 4. Data/domain model — системная карта

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

### Schema truth

Canonical `main` на этом срезе: `w22projectparticipants01`.

Интегрированный historical chain включает, в частности, `w16legacystatus01` → `w17chatmessageenum01` → `w18nativeenumparity01` → последующие revisions до текущего `w22projectparticipants01`.

PR #457 квалифицировался на отдельной composition base с candidate head `w23estimatelifecycle01`. Это **candidate schema evidence**, а не текущий schema head `main`; до merge/requalification он не должен появляться как current master head.

---

# 5. Transaction, idempotency, outbox и provider boundary

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

### Outbox/provider

DomainOutbox/worker должны обеспечивать deterministic intent → claim/lease/fencing → effect → reconciliation → done/terminal/DLQ. Timeout внешнего provider-а не превращается ни в выдуманный успех, ни в слепой повтор.

### Current recovery truth

#322, #414, #416, #418/#459, #460/#465 и ряд других PR дают сильные bounded replay primitives. Но #316 как family-wide проблема остаётся открытой. #383/#392/#404/#412 всё ещё не имеют достаточной integrated comparable qualification. #315/#317 остаются cross-cutting blockers.

---

# 6. API composition

Канонический `/api/v1` объединяет auth/projects/rooms/estimate/budget, stages/work-orders/schedules, materials/purchases/selections, payments/receipts/bank, documents/e-sign/warranty, chat/notifications/automation, technical-supervision, marketplace и operator/admin.

Точная inventory эффективных методов определяется итоговой router composition, а не просто наличием decorator-а. Critical command имеет input/output schema, current actor/resource ACL, missing/null semantics, conflict/provider-pending semantics и replay contract.

GET не должен скрыто изменять business truth. Compatibility path не должен сохранять старую мутацию только потому, что новый canonical route уже существует.

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

Детальные формулы и source hashes ведутся в `technical-spec/CALCULATION-REGISTRY.md`.

---

# 10. Основные business flows и связи

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

# 11. Mobile information architecture and navigation

Цель — стабильная карта, а не phase-driven перестановка navigation.

Canonical concepts:

- Главная;
- Объект;
- Работы/Ремонт;
- Сроки;
- Деньги;
- Сообщения.

При ограничении Dock до пяти destinations позиция должна быть предсказуемой; Schedule остаётся prominent и не теряется как второстепенный смысл.

## 11.1. Canonical route registry inventory

Это source-level inventory, а не обещание полной пользовательской приёмки каждого route.

| ID | Назначение |
|---|---|
| home | Главная |
| object | Объект |
| repair | Ремонт/работы |
| budget | Деньги |
| calendar | Сроки |
| chat | Сообщения |
| manager-dashboard | Управленческая сводка |
| finance-center | Финансовый центр/redirect |
| control | Контроль/приёмка |
| quality-control | Контроль качества |
| work-acceptance | Приёмка работ |
| work-schedule | График работ |
| documents | Документы |
| approvals | Согласования/detail |
| notifications | Уведомления/redirect |
| inbox | Единая очередь внимания |
| scan-receipt | Сканирование чека |
| stage | Деталь этапа |
| materials-procurement | Материалы/закупки |
| selections | Выбор материалов |
| warranty-claim | Гарантийное обращение |
| design | Чертежи/дизайн |
| conflicts | Offline/conflict resolution |
| portfolio | Портфель проектов |
| scratchpad | Черновик |
| budget-planner | Планировщик бюджета |
| checklist-templates | Шаблоны чек-листов |
| guide | Справка |
| activity | История/архив |
| portal | Portal-token flow |
| reports | Отчёты |
| project-analytics | Аналитика/redirect |

Каждый deep link обязан заново проверять current session/role/project/entity authority.

## 11.2. Hub source keys → user labels

Текущие internal keys сохраняются до отдельной bounded migration; user-facing terminology может быть улучшено без подмены source contract.

### Object

| key | user-facing target |
|---|---|
| `rooms` | Комнаты |
| `estimate` | Смета |
| `plan` | Чертежи и дизайн |
| `profile` | Данные объекта |

### Repair

| key | user-facing target |
|---|---|
| `works` | Этапы |
| `control` | Приёмка |
| `materials` | Материалы |
| `selections` | Выбор материалов |

### Budget

| key | user-facing target |
|---|---|
| `summary` | План–факт |
| `expenses` | Расходы/затраты |
| `payments` | Оплаты/поступления |
| `deviations` | Отклонения |

## 11.3. Schedule

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

# 13. UI design system — exact source tokens and UX outcome contract

Source-level values на текущем canonical cut:

| Token | Значение |
|---|---|
| primary | `#334155` |
| accent | `#2563EB` |

Minimum touch target: **44 px**.

```text
display 32
hero    24
h1      22
body    14
```

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

# 14. Tests and verification matrix

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

# 15. Независимые критические PR-контуры и evidence classes

Open PR не становится `PROVEN`. Текущая детальная ledger находится в Completion Board.

Ключевые актуальные линии:

- #425 → #389/#372/#437/#450: trusted integration/runtime/dependency lineage;
- #444/#424/#452/#441 и #455→#456: object authority / ACL;
- #322 и descendants: replay/atomicity;
- #315/#317: global session/offline/cache;
- #382: finance/calculation truth;
- #448/#457/#458: estimate/change/GP1 lifecycle;
- #300/#344/#345/#429: multi-contractor;
- #319/#320: purge/native-file lifecycle;
- #367: deployed review evidence, но не canonical integration base.

Historical #282/#283/#284/#286/#287 остаются traceability lineage, а не текущими задачами для повторного merge.

---

# 16. Known gaps / improvement backlog

Текущий backlog не определяется возрастом issue. Он пересчитывается Completion Board по risk/dependency.

На текущем evidence cut:

1. trusted integration foundation;
2. security/data authority;
3. replay/atomicity;
4. session/offline/cache;
5. financial truth;
6. connected GP1;
7. multi-contractor GP2/GP3;
8. lifecycle edges;
9. Human Usability Closure;
10. one-SHA internal acceptance;
11. external production qualification.

Новые крупные features, dashboards, AI flows или provider integrations не обгоняют core closure без отдельного решения владельца.

---

# 17. Traceability matrix

| Требование | Authority / contract | Текущий blocker/evidence class |
|---|---|---|
| Session/account | client/session/offline contracts | #315/#317; BLOCKED |
| Project create/lifecycle | canonical project services | #434/#319; PARTIAL/BLOCKED |
| Participant/scope | ProjectParticipant + scope contracts | #300/#344/#345; BLOCKED |
| Estimate/change | Estimate/ChangeOrder contracts | #444/#412/#448/#457/#458 |
| Execution | Stage/WorkOrder/schedule | #452/#383/#404/#461 + #316 |
| Materials | selection/material/purchase/receipt | #416/#460 + broader procurement PARTIAL |
| Finance | calculation registry + payment/expense truth | #382 + GP5 BLOCKED |
| Chat/inbox | chat/request identity/inbox | #322 + #315/#316/#317 |
| Documents/files | document/version/storage/native | #320 + provider/retention |
| Acceptance/warranty | acceptance/issue/warranty | #418 + closeout lifecycle |
| UI/screens | screen catalog + routeRegistry | deployed #367 browser failures |
| Production | readiness evidence | FUTURE EXTERNAL + internal blockers |

---

# 18. Documentation Definition of Done

Документация считается синхронизированной, когда:

1. master schema header совпадает с actual Alembic graph/readiness;
2. source snapshot rows совпадают с current tracked blobs;
3. Board отражает current main/candidate/deployed evidence;
4. roadmap отражает dependency order;
5. mandate сохраняет acceptance без stale fixed ordering;
6. affected domain/calculation/screen contract обновлён;
7. PR body содержит exact evidence boundary;
8. historical snapshots не используются как current verdict.

Запрещено закрывать issue по ограниченному foundation, выдавать audit/source presence за runtime test, сохранять unknown как 0, обозначать unavailable capability как DONE или переносить старый green на новый SHA.

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

---

# 21. Machine-verifiable source snapshot

Эта таблица связывает living master с конкретными source blobs. Она не доказывает runtime correctness; её задача — не позволить source изменить без явной reconciliation документации.

| Source | Blob SHA | Назначение |
|---|---|---|
| `AGENTS.md` | `767d38e76d04209e609bbe7173a2c448cfc5fa00` | Engineering policy |
| `backend/app/api/v1/router.py` | `8663e5b54289b133c5a2ff30af0533cfee93dfb6` | API composition |
| `backend/app/models/entities.py` | `f2e63f316fa8c9b2012894ae4e496dc76a73a3a1` | Domain entities/enums |
| `backend/app/main.py` | `223e83b13f96398eefe997275ac6f41fa44bfbcf` | API lifespan/runtime |
| `backend/app/services/seed_demo.py` | `c62ba920130a7ba7f6e2bd0a54e63feadce5c6cd` | Development seed |
| `backend/scripts/verify_orm_schema_parity.py` | `ba08d0681df301f446b3adbf811ad9367eeb24b9` | ORM/schema parity |
| `backend/scripts/verify_current_migration_schema.py` | `13e63544564b41a13c52f9437b9bfbdfa290913b` | Migration invariants |
| `apps/mobile/lib/routeRegistry.ts` | `0c9a386486f61cd1a284d8bd7fc99368b557232f` | Canonical navigation registry |
| `apps/mobile/constants/Theme.ts` | `6e66c4bf0db8c9d1b8c4a2d0355311145ca43b20` | Theme/touch geometry |
| `apps/mobile/constants/typography.ts` | `8a96b7f290944ac2c566c0f1791c1f60ab90c68a` | Typography |
| `apps/mobile/constants/screenTypography.ts` | `f91c9a659a1ab8603ae4d82eb46d76754627b5bb` | Screen typography |
| `apps/mobile/constants/uiTokens.ts` | `ca2d8e9e03f56efb058041ad8a81c04d15c7a8a0` | UI tokens |
| `apps/mobile/constants/screenLayout.ts` | `0165f3c86d829311e91ac17b875c23ccaefab12b` | Screen layout |
| `apps/mobile/components/renova/os/OsHubTabs.tsx` | `f480067b06c750623e4091fe0db128c877e3fb37` | Hub tabs |
| `apps/mobile/components/screens/OsObjectHubScreen.tsx` | `3082b1bf59cbf420d403ed82b35bbc2e78697728` | Object hub |
| `apps/mobile/components/screens/OsRepairHubScreen.tsx` | `5fe0e6229ad4cc82462ea4cfc1f7d213c7687305` | Repair hub |
| `apps/mobile/components/screens/OsBudgetHubScreen.tsx` | `4e0e8267d68b600cf0d8bdf716a4c8eddaa3bcbd` | Budget hub |
| `apps/mobile/constants/budgetTabs.ts` | `d02c05560176535e130d76960c2b67691bcbb3b7` | Budget tabs |
| `.cursor/rules/renova-design-system.mdc` | `2f48e46f5b348b8cbc3a370615a5a5e93d93421f` | Design rules |
| `package.json` | `4c95fcf89d7e29f1c464a7db2c7aa4c85335fe11` | Root commands/test entrypoints |
| `.github/workflows/local-runtime-integrity.yml` | `3ae00fa13be960bf7acba71c8cfa41134d35e16f` | Local runtime proof |
| `backend/alembic/versions/w16legacystatus01_legacy_status_enum_parity.py` | `d2137f2b87c1ac6f679093331bd034aff17c8188` | Legacy enum parity |
| `backend/alembic/versions/w17chatmessageenum01_chat_message_enum_parity.py` | `0537268c85e26b7a607d36f967a3402b8bba53c4` | Chat enum parity |
| `backend/alembic/versions/w18nativeenumparity01_remaining_native_enum_parity.py` | `d210b757441efedf7c3e7959ba45321f02962dc4` | Native enum parity |
| `docs/technical-spec/CHANGELOG-ROADMAP.md` | `a42fcb11d80bb8ca7f0f4358c9131bd3d0a22788` | Current dependency-aware roadmap |
