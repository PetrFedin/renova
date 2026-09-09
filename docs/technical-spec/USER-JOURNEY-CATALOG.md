# RENOVA — каталог пользовательских сценариев и действий

**Status:** ACTIVE / governed product annex.
**Parent:** `PRODUCT-COMPLETION-MANDATE.md`.
**Purpose:** функциональный каталог действий заказчика/исполнителя. Он не заменяет domain contracts или Golden Paths; он связывает UI-намерение с бизнес-результатом и recovery. Secondary-сценарии ниже обязательны к классификации так же, как core flows: существующий secondary screen не может оставаться «висящей функцией» без роли, terminal result и связи с canonical domain.

## 0. Universal scenario contract

Для каждого действия применяются общие правила:

- пользователь видит только разрешённый resource/scope;
- mutation имеет явный outcome `committed | queued | unknown_needs_reconcile | authoritative_refusal`;
- stable identity создаётся до первой сети для replay-sensitive action;
- после commit follow-up refresh failure не повторяет business mutation;
- server/domain truth важнее optimistic UI;
- stale financial/approval data помечены и revalidated перед irreversible action;
- notification/WS/push не являются source of truth;
- every external provider action goes through a port;
- audit/history сохраняют actor/time/decision и релевантную причину;
- deleted/removed user authority не удаляет historical facts.

---

# 1. Заказчик — account/project lifecycle

| ID | Сценарий | Preconditions | Успешный terminal result | Negative / recovery |
|---|---|---|---|---|
| C-A01 | Регистрация по телефону | номер валиден | OTP подтверждён, session создана | rate limit/неверный код/истёкший код → controlled retry |
| C-A02 | Повторный вход | account существует | новая session generation | старые requests предыдущей session не публикуются |
| C-A03 | Refresh session | refresh действителен | новый access token принадлежит той же generation | logout/account switch during refresh → результат отбрасывается |
| C-A04 | Logout | active session | local authority очищена, server revoke attempted | offline revoke → local logout всё равно успешен, server revoke не заявляется |
| C-A05 | Смена A→B | два accounts | UI/cache/queue показывают только B | pending A response/queue не выполняется как B |
| C-A06 | A→B→A | возврат к тому же user id | третья generation независима | old A1 completion не принимается A2 |
| C-P01 | Первый запуск без проектов | login | понятный empty state → создать объект | никакого fabricated demo project |
| C-P02 | Создать проект | valid wizard | один authoritative Project + rooms/initial data | response loss → reconcile/replay same request id |
| C-P03 | Выбрать проект | есть access | activeProject = exact loaded project | competing selection: последняя актуальная intent выигрывает, stale response не publish |
| C-P04 | Архивировать проект | allowed lifecycle | project hidden from active, data retained | unresolved constraint → explicit refusal |
| C-P05 | Восстановить из архива | archived | active again with history | stale/deleted → clear not-found outcome |
| C-P06 | Удалить в корзину | policy allows | trash state | retention/legal hold → reason, no physical loss |
| C-P07 | Purge | retention satisfied/admin contract | full governed graph removed + storage cleanup | dependency/provider cleanup failure → recoverable state, not partial silent success |

---

# 2. Заказчик — объект, комнаты, смета

| ID | Сценарий | Успех | Key guards |
|---|---|---|---|
| C-O01 | Добавить комнату | Room persisted, snapshot updated | dimensions/type validation; offline replay safety if queued |
| C-O02 | Изменить размеры/тип | new room state + change-log | session fence; change impact not silently applied to approved budget |
| C-O03 | Архивировать/restore room | room state changes, history retained | estimate/material references handled explicitly |
| C-O04 | Рассчитать материалы комнаты | deterministic calculation output | calculation provenance/version; no auto purchase |
| C-O05 | Получить snapshot/history | exact authorized room truth | cached provenance, no sibling disclosure |
| C-E01 | Создать/получить estimate | versioned estimate lines | calc-engine parity where applicable |
| C-E02 | Редактировать draft estimate | new draft truth | approved version immutable unless change workflow |
| C-E03 | Утвердить baseline | original approved plan fixed | actor authority + version conflict |
| C-E04 | Создать change order | draft change with impact | no budget change before approval |
| C-E05 | Approve/reject change | revised plan/schedule changes only if approved | concurrent version/decision conflict |
| C-E06 | Смотреть budget projection | Original/Revised/Committed/Actual/Paid/Refund | fact from ledger or unavailable, exact sum conservation |

---

# 3. Заказчик — marketplace и участники

| ID | Сценарий | Успех | Negative / recovery |
|---|---|---|---|
| C-M01 | Опубликовать lead | eligible lead visible to contractors | duplicate publish idempotent/conflict |
| C-M02 | Получить предложения | comparable quotes | withdrawn/expired clearly marked |
| C-M03 | Сравнить quotes | price/scope/time/verified attrs visible | source/as-of for any benchmark data |
| C-M04 | Выбрать contractor | lead transition + participant + notifications atomic | race → exactly one authoritative result |
| C-M05 | Выбрать несколько principals по scopes | multiple participants with non-overlapping/explicit scopes | no one-global-contractor overwrite |
| C-M06 | Пригласить внешнего contractor | invitation→participant lifecycle | provider SMS unavailable → invite remains durable/explicit |
| C-M07 | Изменить scope | future authority/recipient sets update | in-flight old authority fenced/revalidated |
| C-M08 | Удалить participant | future access revoked, history preserved | open work/payment/doc responsibility remains historical |
| C-M09 | Reassign stage/work | new authorized participant | previous assignee history preserved; sibling finance still private |

---

# 4. Заказчик — график и контроль работ

| ID | Сценарий | Успех | Guards |
|---|---|---|---|
| C-S01 | Смотреть schedule | canonical schedule/dependencies | calendar is projection, not second SoT |
| C-S02 | Предложить/изменить даты | validated mutation/draft | dependency conflicts; contractual impact → approval/change path |
| C-S03 | Утвердить schedule | approved version/state | version conflict if contractor changed meanwhile |
| C-S04 | Смотреть progress | facts from stages/work | no progress from queued-only action |
| C-S05 | Смотреть photos/evidence | exact scope resources | file ACL + session-generation fence |
| C-S06 | Получить attention item | exact actionable issue | inbox is read model, deeplink rechecks ACL |
| C-S07 | Экспортировать ICS | valid authorized calendar file | native/web outcomes separate; export does not change schedule |

---

# 5. Заказчик — материалы

| ID | Сценарий | Успех | Guards |
|---|---|---|---|
| C-MAT01 | Смотреть потребность | quantity by room/stage | calculation provenance |
| C-MAT02 | Смотреть предложение материала | item/price/source/as-of/required date | unknown price not invented |
| C-MAT03 | Approve material | MaterialPick approved | version/scope/budget threshold |
| C-MAT04 | Reject material | rejected with reason | no hidden purchase creation |
| C-MAT05 | Approve analog | replacement linked to original need | audit original/proposed item |
| C-MAT06 | Смотреть purchase | ordered/paid/delivery state | payment state ≠ delivery state |
| C-MAT07 | Смотреть partial delivery | quantity delivered/remaining | do not encode as partial payment |
| C-MAT08 | Return/replace | return/replacement lineage | expense/refund treatment explicit |
| C-MAT09 | Drill to receipt | exact purchase→receipt/evidence | receipt does not duplicate expense |

---

# 6. Заказчик — приёмка, спор, гарантия

| ID | Сценарий | Успех | Guards |
|---|---|---|---|
| C-ACC01 | Получить submission | `on_review` + evidence | exact participant/stage authority |
| C-ACC02 | Вернуть на доработку | rework + issue list + SLA | issues tied to stage/work/room/evidence |
| C-ACC03 | Принять работу | accepted immutable decision lineage | open required issues → conflict |
| C-ACC04 | Решение по portal token | same canonical acceptance result | exact resource, one-use/replay, no cross-project token |
| C-ACC05 | Повторная сдача | new submission preserving old history | no overwrite of first failure |
| C-W01 | Создать warranty claim | claim tied to accepted work/principal | warranty basis/date validation |
| C-W02 | Принять warranty resolution | claim closed with evidence | unresolved evidence → explicit state |

---

# 7. Заказчик — деньги

| ID | Сценарий | Успех | Guards |
|---|---|---|---|
| C-F01 | Получить invoice/payment request | pending Payment linked to project/stage/payee | invoice creation does not recognize Expense |
| C-F02 | Запустить platform checkout | provider operation pending | simulator now, real adapter later; stable idempotency |
| C-F03 | Provider success | Payment transition + outbox/reconciliation + finance recognition per contract | duplicate/out-of-order webhook safe |
| C-F04 | Provider cancel/failure | canonical non-paid state | no Expense, no false UI success |
| C-F05 | Manual transfer evidence upload | versioned private evidence | MIME/size/hash/ACL; no direct object-key authority |
| C-F06 | Submit evidence | submitted/paid_unverified contract | immutable submitted bytes |
| C-F07 | Получить reviewer decision | accepted/rejected outcome visible | customer does not self-review; reviewer authority separate |
| C-F08 | Retry after rejected evidence | new evidence version | old rejected version retained |
| C-F09 | Receipt/fiscal status | verified/unverified/mismatch/not-found | provider result separate from Expense/Payment |
| C-F10 | Открыть dispute | dispute state + participants notified | disputed amount validated |
| C-F11 | Partial/full refund | Refund lineage + adjusted financial projection | idempotent/reconcilable provider op |
| C-F12 | View payment progress by stage | exact paid/pending/refunded view | avoid double counting evidence/receipt |

---

# 8. Заказчик — документы и communication

| ID | Сценарий | Успех | Guards |
|---|---|---|---|
| C-D01 | Создать/получить draft contract | ProjectDocument version | correct parties/scope |
| C-D02 | Новая версия | immutable previous + new version | signed version never overwritten |
| C-D03 | Подписать in-app/simulated | signature on exact version | signer authority + idempotency |
| C-D04 | Provider signature later | reconciled signed status | no provider-specific truth in core |
| C-D05 | Export archive/1C/file | exact authorized artifact | native/web file outcomes + scoped content |
| C-CH01 | Написать сообщение | persisted message + recipients/outbox | offline/replay/session ownership |
| C-CH02 | Создать task из сообщения | one WorkOrder/task linked to source | atomic/idempotent; source link immutable enough |
| C-CH03 | Создать invoice из сообщения | one pending payment linked to source | no premature Expense/provider call |
| C-CH04 | Смотреть participants thread | actual authorized participants | removed actor not shown as active |
| C-CH05 | Read/unread | authoritative read state | equal timestamp deterministic |
| C-N01 | Получить push/inbox | attention/read model updated | push failure does not lose business fact |

---

# 9. Исполнитель — marketplace/project lifecycle

| ID | Сценарий | Успех | Guards |
|---|---|---|---|
| E-A01 | Registration/login/logout/switch | same session contract as customer | no queue/cache crossover |
| E-P01 | Смотреть eligible leads | only permitted/current leads | NPD/capacity/source policy applied via canonical truth |
| E-P02 | Отправить quote | versioned proposal | stable identity; no duplicate quote unintended |
| E-P03 | Изменить/withdraw quote | explicit lifecycle | customer sees current + history where required |
| E-P04 | Выбран customer | participant/access appears atomically | no hidden assign on project read |
| E-P05 | Смотреть `мои проекты` | projects from participant authority | removed/inactive excluded from future access |

---

# 10. Исполнитель — planning and field execution

| ID | Сценарий | Успех | Guards |
|---|---|---|---|
| E-S01 | Создать/редактировать stage in scope | stage persisted | customer/scope approval rules |
| E-S02 | Создать WorkOrder | exact assignee/stage/work | direct POST replay-safe before auto retry |
| E-S03 | Start stage | explicit started state | dependency/schedule approval/material readiness not implicit start |
| E-S04 | Обновить progress | authoritative progress fact | duplicate/offline handling |
| E-S05 | Загрузить фото | media linked to work/stage | file ACL/session fence/storage ambiguity |
| E-S06 | Зафиксировать blocker/issue | structured issue/activity | notify relevant customer/participants |
| E-S07 | Submit for review | acceptance/submission state | required evidence/conditions |
| E-S08 | Получить rework | issues + SLA | only responsible scope sees commercial/private details |
| E-S09 | Resubmit | history preserved | no reset/delete of previous review |

---

# 11. Исполнитель — materials, money, docs

| ID | Сценарий | Успех | Guards |
|---|---|---|---|
| E-MAT01 | Формировать material need | linked room/stage quantities | calc/provenance |
| E-MAT02 | Предложить item/analog | pending selection | customer approval required where configured |
| E-MAT03 | Create purchase | canonical Purchase | budget/scope/idempotency |
| E-MAT04 | Update delivery | delivered quantities/status | delivery separate from payment |
| E-MAT05 | Return/replacement | lineage retained | finance effect explicit |
| E-F01 | Выставить invoice | pending Payment exact payee | duplicate-safe |
| E-F02 | Attach receipt/evidence | versioned proof | fiscal vs expense truth separated |
| E-F03 | Observe paid/refunded/disputed | accurate payment history | no stale fake success |
| E-D01 | Sign own document | signature exact party/version | cannot sign sibling contractor document |
| E-D02 | Download/share artifact | authorized native/web outcome | access revoked/session switch safe |
| E-W01 | Receive warranty claim | exact historical responsibility | removed membership does not erase duty/history |
| E-W02 | Resolve warranty | evidence + closure | customer sees outcome |

---

# 12. Multi-contractor negative scenarios

1. E1 cannot read/mutate E2 sibling stages without scope.
2. E1 cannot see E2 private financial evidence, payment recipient details or private documents unless explicitly shared.
3. Customer sees aggregate schedule/budget but every line retains responsible principal attribution.
4. Reassigning stage E1→E2 changes future authority, not historical actor attribution.
5. Chat recipient set follows thread/scope, not global project membership.
6. Push/inbox/background job revalidates current authority before delivering sensitive content/action.
7. Shared room does not automatically grant all commercial/document rights.
8. One contractor removal does not close project or revoke other contractors.
9. One participant capacity/rate/subscription state cannot mutate another contractor principal.
10. Project-level lead/general contractor remains optional coordinator, not implicit owner of sibling contractors.

---

# 13. Reliability/recovery scenario catalog

| ID | Failure | Required result |
|---|---|---|
| R01 | offline before send | durable queue only for supported replay-safe action |
| R02 | timeout before server receives | same stable intent can replay |
| R03 | timeout after server commit | retry same identity returns original; no duplicate |
| R04 | app restart with queue | actor-owned serialized intent survives per policy |
| R05 | logout with queued A jobs | jobs cannot execute as next actor B |
| R06 | A→B→A | old generation never publishes |
| R07 | token refresh races logout | old refresh cannot restore token |
| R08 | two project loads race | stale completion cannot replace selected project |
| R09 | stale cached GET | provenance visible; no freshness laundering |
| R10 | server 409 version conflict | UI reloads current truth, deliberate retry/new version |
| R11 | worker crash after outbox claim | lease/fencing/rescue; no lost job |
| R12 | duplicate provider webhook | one domain effect |
| R13 | webhook before expected read state | durable/reconcilable processing, no guessed success |
| R14 | provider timeout | unknown/reconcile, not blind success/failure |
| R15 | S3 write ambiguous | deterministic object/intent + reconcile/cleanup |
| R16 | refresh fails after mutation commit | show committed + stale/reload issue, no second business mutation |
| R17 | access revoked while request waits | fresh authority revalidation before sensitive mutation/publish |
| R18 | native share cancelled | cancelled outcome, not «file saved» |
| R19 | financial category lacks fact | unavailable/null, not plan copied to fact |
| R20 | purge graph contains new FK | lifecycle service handles/refuses cleanly, no raw IntegrityError |

---

# 14. Product coverage rule

Для каждого business scenario из каталога должно быть одно из:

- `IMPLEMENTED + entry + test evidence`;
- `IMPLEMENTED backend / UI gap` с issue;
- `PLANNED` с Mandate task/issue;
- `NOT APPLICABLE` с объяснением;
- `EXTERNAL ACTION REQUIRED` для real provider/legal/infrastructure.

Нельзя оставлять business action в состоянии «endpoint существует, значит функция готова» или «кнопка есть, но terminal result не проверен».

---

# 15. Secondary customer/contractor flows — существующие продуктовые поверхности

Secondary не означает необязательный dead end. Если поверхность остаётся в canonical navigation/product UI, она обязана либо иметь законченный lifecycle, либо быть честно переведена в planned/unavailable и связана с issue.

## 15.1. Design packages / дизайн-пакеты

Code/source подтверждает отдельные `DesignPackage`, API/service, mobile `DesignPackageList` и inclusion в approvals/documents. Целевая цепочка:

`contractor/design author creates draft → uploads exact files/version → submit → customer sees package + scope/room context → approve OR reject with reason → approved package becomes referenced design decision → subsequent changed content creates new version/package transition, not silent overwrite`.

Правила:
- reject path обязателен рядом с approve;
- approval не создаёт сам по себе Expense/Purchase;
- package files obey private file ACL/native delivery;
- multi-contractor sees only shared/relevant package scope;
- signed/approved package history immutable enough for dispute/change lineage;
- design package status can feed attention/calendar but is not second document SoT.

## 15.2. Waste orders / вывоз мусора

Source подтверждает `WasteOrder`, service/router, approvals, calendar/analytics inclusion и mobile `WasteOrderList`.

Целевая цепочка:

`need/room-stage context → request/order draft → price/volume/date/provider responsibility → customer approval or reject → scheduled → completed with fact/evidence → expense/receipt linkage if economic event exists`.

Обязательные cases:
- reject with reason;
- cancelled/failed service;
- changed volume/date/price after approval → explicit change/reapproval when material;
- completed fact distinct from merely approved order;
- no plan-as-fact in budget/portfolio;
- calendar reminder references canonical order.

## 15.3. Approvals hub

Approvals — **projection of pending decisions**, not отдельный state machine. It may aggregate MaterialPick, ChangeOrder, DesignPackage, WasteOrder and other explicitly governed decision objects.

For every card:
- exact source entity + version;
- who may decide;
- approve and reject when business lifecycle permits;
- reason/comment where required;
- stale/version conflict revalidation;
- after decision card disappears/changes because source entity changed, not because local UI hid it;
- deeplink opens canonical entity.

## 15.4. Calendar item CRUD and upcoming

Calendar hub combines schedule-derived events and explicit calendar items. User scenarios:
- list upcoming;
- create/edit/delete explicit item if role permits;
- navigate from event to source entity;
- sync stage-derived projection without duplicating Stage schedule truth;
- export project ICS;
- handle timezone/date-only semantics explicitly.

Deleting a calendar projection must not delete its source Stage/Payment/Delivery unless the domain command explicitly performs that transition.

## 15.5. Technical supervision / quality control

Technical supervisor may record observations/evidence/quality findings only within granted project/scope. Supervisor does not automatically accept work for customer, pay invoice, change contractor scope or sign as a party.

Target result:
`inspection/observation → linked room/stage/work/photo → severity/status → responsible participant visibility → issue/remediation where configured → closure evidence`.

If quality-control screen duplicates acceptance issue state, canonical linkage must be proven instead of maintaining two defect truths.

## 15.6. Viewer/share access

Invited viewer receives minimum read-only scope. Invite/revoke lifecycle must define:
- resource/project binding;
- expiration/status where modeled;
- no mutation through deeplink;
- file/chat/finance restrictions;
- revoked viewer loses future access immediately while audit remains.

## 15.7. Notifications and preferences

Inbox/notification list is read model. User can:
- open relevant item;
- mark/read according to canonical contract;
- follow deeplink after fresh ACL check;
- distinguish delivery failure from business event failure.

If notification preferences exist, they control delivery channel where lawful, not suppression of required business/audit state.

---

# 16. Secondary contractor/business flows

## 16.1. Subscription/capacity

Subscription is not project authority. It may affect marketplace/capacity/feature entitlements according to one policy service, but:
- expired plan does not silently erase historical projects;
- capacity check happens atomically at assignment/conversion;
- payment provider state for subscription stays separate from renovation project Payment/Expense;
- downgrade/upgrade shows user impact before commitment;
- real billing provider remains port-based later.

## 16.2. Checklist templates

Checklist template is reusable planning content, not fact of completed work. Applying template creates/links actual checklist/work items under the target Stage/WorkOrder. Template edit cannot rewrite historical completed checklist evidence.

## 16.3. Activity/history

Activity is a read/audit projection. It must link to canonical events and never become a second mutable business journal. Sensitive activity follows project/scope ACL.

## 16.4. Guide/help

Guide is contextual help only. It cannot be used to hide incomplete workflow. Help CTA must route to a real canonical action or explanation; outdated guide text is governed documentation defect.

## 16.5. Scratchpad

Scratchpad, if retained, is explicitly non-authoritative personal/project note space. It cannot silently create scope, cost, schedule, acceptance or payment truth. Promotion from note to task/change/order must be an explicit canonical mutation.

---

# 17. Reporting, analytics and portfolio scenarios

Reports/analytics are read models over canonical facts. Required rules:

1. every KPI has definition/source/status/as-of;
2. missing source fact → unavailable, not zero;
3. project total reconciles to drill-down;
4. portfolio aggregation preserves project attribution and currency/date rules;
5. contractor only sees projects/scopes permitted by authority;
6. customer sees own project/portfolio if multi-project feature permits;
7. CSV/PDF/export uses canonical authenticated file delivery;
8. expense CSV and budget lines are not considered complete merely because backend route exists — entry point and successful native/web output must be classified;
9. reports cannot mutate financial source data.

Potential contractor profitability is T1 only after revenue/cost recognition sources are explicit; customer budget must not be re-labelled contractor profit.

---

# 18. Operator/support/reconciliation scenarios

Although customer/contractor are primary personas, a working product requires a bounded operator plane.

Operator/admin may, only through explicit RBAC:
- review manual payment evidence where current decision-right contract requires admin reviewer;
- inspect provider reconciliation state;
- inspect/replay DomainOutbox/DLQ with audit;
- investigate failed notifications/provider operations;
- perform authorized support recovery without impersonating business acceptance/payment decisions;
- inspect runtime/readiness diagnostics appropriate to role.

Operator cannot:
- manufacture successful external-provider verification;
- edit signed historical evidence to make reconciliation green;
- bypass participant ACL for ordinary customer workflow without logged administrative authority;
- use demo endpoints in staging/production.

Every manual recovery records actor, reason, before/after state and resulting business event where applicable.

---

# 19. Portal/deeplink/external-entry scenarios

Any route entered from notification, link, portal token, email/SMS invite or future partner flow must:

1. parse only expected identifiers/token;
2. validate session or token authority;
3. bind exact project/resource/action;
4. reject cross-project substitution;
5. load canonical current state;
6. handle expired/used/revoked link distinctly;
7. restore canonical navigation context after success;
8. never trust stale `activeProject` as authorization;
9. avoid exposing resource existence to unauthorized actor according to contract;
10. make repeat/replay behavior explicit.

This applies to acceptance portal, invitations, document/payment returns and future provider callback landing pages.

---

# 20. Coverage closure rule

Product completion review must inventory **all canonical routeRegistry entries + all user-visible screens/sheets/actions + all external-entry flows** and map each to this catalog/Golden Path/domain contract.

Allowed classifications:
- `CORE ACTIVE` — required full lifecycle/evidence;
- `SECONDARY ACTIVE` — still no dead ends; lifecycle/evidence required;
- `READ MODEL` — no independent writer;
- `COMPATIBILITY REDIRECT` — canonical target + deeplink test;
- `PLANNED` — hidden/unavailable honestly + issue;
- `OPERATOR ONLY` — explicit RBAC, absent from normal user menus;
- `EXTERNAL FUTURE` — provider/partner port prepared, no live claim;
- `RETIRED` — removal proof and compatibility decision complete.

Ни один user-visible route/action не может оставаться `UNCLASSIFIED`. Это заменяет неточный критерий «каждый backend route должен иметь mobile consumer»: service/webhook/operator routes могут не иметь mobile UI, но каждый **product surface** обязан иметь владельца, entry, terminal result и evidence.