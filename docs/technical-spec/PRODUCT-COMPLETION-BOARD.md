# RENOVA — Product Completion Board

**Статус:** ACTIVE / AUTHORITATIVE EXECUTION BOARD  
**Дата сверки:** 2026-09-16  
**Канонический `main`:** `e5c6ee44c0f684b14037e77948dbcb630fd41896`  
**Назначение:** единственная оперативная карта того, что уже доказано, что существует только как кандидат, что частично, что заблокировано и что делать следующим.

Этот документ не заменяет `docs/RENOVA-TECHNICAL-SPECIFICATION.md`, `GOLDEN-PATHS.md`, `CALCULATION-REGISTRY.md` и domain-contract приложения. Он связывает их в один исполняемый порядок.

## 1. Допустимые статусы

В Completion Board разрешены только пять состояний:

- **PROVEN** — полный пользовательский результат доказан на каноническом интегрированном срезе с применимыми normal/error/retry/reversal/ACL проверками.
- **CANDIDATE PROVEN** — результат доказан на конкретном candidate SHA, но ещё не вошёл в канонический `main`; после rebase/merge требует проверки на новом exact SHA.
- **PARTIAL** — часть цепочки реализована/проверена, но полного результата или обязательных негативных сценариев нет.
- **BLOCKED** — есть известный дефект, зависимость или недостающий внешний gate, из-за которого результат нельзя считать готовым.
- **FUTURE EXTERNAL** — продуктовый контракт сохранён, но итоговое доказательство требует реального внешнего провайдера/среды/административного действия и не должно подменяться симуляцией.

Проценты готовности, субъективные оценки и календарные ETA без согласованных весов/ресурсов здесь запрещены.

## 2. Текущая общая правда

| Контур | Статус | Текущая правда |
|---|---|---|
| Канонический `main` | PARTIAL | `e5c6ee44…`; содержит интегрированное ядро через #314 и governance bootstrap, но не все квалифицированные кандидаты сентября. |
| Broad production | BLOCKED | Product-integrity, security, browser/native, staging/external gates не закрыты. |
| Review role/project entry | CANDIDATE PROVEN | На PR #367 / SHA `0d58416…` четыре role×project entry теста прошли. |
| Deployed mutation/recovery proof | CANDIDATE PROVEN | Run `35084701908`: `deployed-mutation-proof` SUCCESS. Это не полный UI-E2E. |
| Deployed product browser smoke | BLOCKED | Тот же run: Chromium и WebKit product jobs FAILURE; Chromium — 4 passed / 6 failed. |
| Review hosting | PARTIAL | Публичный review stand доступен, но free-host cold start и не полностью зелёный browser flow не позволяют считать стенд acceptance-ready. |
| Real providers | FUTURE EXTERNAL | Реальные платежи/SMS/e-sign/FNS и production delivery не включены и не должны изображаться как доказанные. |

## 3. Активные квалифицированные/открытые кандидаты

| PR / issue | Статус | Доказанность | Что делать |
|---|---|---|---|
| #425 | CANDIDATE PROVEN | open, non-draft, exact head `9984e7b…`; CI/local-runtime/typecheck/snapshot/technical/security checks заявлены зелёными | Owner merge по review policy; затем все stacked candidates rebase/requalify. |
| #372 | CANDIDATE PROVEN | draft, stacked on #425; exact head `6d6ef7e…`; dependency/CI/local-runtime checks зелёные на своей линии | После #425 retarget на `main`, requalify, затем owner review/merge. |
| #322 / часть #316 | CANDIDATE PROVEN | draft; exact head `582fd727…`; chat invoice/task atomicity + replay proof; full #316 не закрыт | Независимый review; refresh на актуальный `main`; не закрывать #316 целиком. |
| #367 review stand | PARTIAL | open; head `0d58416…`; role entry и mutation proof проходят, product browser smoke падает | Использовать как integration/review evidence, не как замену `main`; устранить browser blockers и раздробить/квалифицировать merge scope. |
| #315 | BLOCKED | global session/account generation fencing не интегрирован как полный контракт | После replay/ACL P0: A→B→A, project switch, token refresh, storage, inbox, queue, navigation. |
| #316 | BLOCKED | часть chat commands квалифицирована в #322; остальные queued mutations требуют инвентаризации | Закрыть mutation family inventory и exactly-once policy. |
| #317 | BLOCKED | transport/cache fixes существуют в candidate work, но каноническая полная acceptance не доказана | req→producer→durable queue→flush + stale-cache provenance. |
| #318 | BLOCKED | известная ошибка period allocation и неполный portfolio actual contract; candidate work не равно merge | Доказать sum-preserving allocation, null unknown actual, timezones, drill-down reconciliation. |
| #319 | BLOCKED | purge непустого project graph и retention не замкнуты | Full PostgreSQL graph + hold/refusal/rollback/storage recovery. |
| #320 | BLOCKED | native chat PDF export не доказан | iOS/Android/web authenticated file delivery + cancel/cleanup/session isolation. |
| #300 | PARTIAL | participant foundation существует, full multi-contractor product scope нет | Завершить после core integrity либо fail-closed скрыть unsupported configuration до завершения. |

## 4. M01–M12 — карта продукта

| Модуль | Статус | Что уже есть | Что остаётся до PROVEN |
|---|---|---|---|
| **M01 Identity / Session / Role** | BLOCKED | auth/session, customer/contractor, role wrappers, project selection, read-only, token lifecycle | #315 generation fence; cross-account queue/storage/cache/navigation; A→B→A; revoked rights; device/browser acceptance. |
| **M02 Project / Object** | PARTIAL | project create, profile, rooms, quick/detailed wizard, plans/design, participants foundation | Full create→counterpart→edit→history→archive/restore; multi-participant scope; browser shell stability; deletion graph. |
| **M03 Estimate / Change** | PARTIAL | template estimate, lines, versions/proposal/lock, change orders, documents, budget links | Unified role journey; conflict/reversal; exact dependent recalculation; stable discoverability; browser/mobile GP proof. |
| **M04 Execution / Schedule** | PARTIAL | stages, work orders, dependencies, explicit start, progress, photos, schedule/calendar, acceptance entry | All create/status mutations idempotent; role/scoped assignment; offline/retry; stage aggregate UX; full GP3. |
| **M05 Materials / Procurement** | PARTIAL | selections, material source/responsibility, availability, purchases, receipts, delivery statuses, price provenance | Exact lifecycle semantics, partial/return reconciliation, truthful post-commit UI, scope, offline/retry, GP6. |
| **M06 Finance** | BLOCKED | estimate/budget, expenses, payments, receipts/evidence, forecast, deviations, manual evidence path | #318 calculations; single source of fact; obligations vs cash vs plan; refunds/partials; drill-down; provider ambiguity; GP5. |
| **M07 Communication / Inbox** | PARTIAL | threads, messages, files, reactions, unread/read, WebSocket, inbox, task/invoice links | #322 merge lineage + remaining #316/#317; native export; one canonical attention center; account/session isolation; GP8. |
| **M08 Decisions / Approvals** | PARTIAL | approval hub, approve/reject, estimate/material/change/schedule decisions, inbox links | One canonical detail flow, stale-data fail-closed, offline semantics, actor/next-action clarity, counterpart proof. |
| **M09 Quality / Acceptance / Warranty** | PARTIAL | customer/contractor/supervisor control, issues, rework, acceptance, warranty create/close paths | Unified lifecycle/card; closeout→warranty E2E; role authority; document/evidence links; GP4 and final lifecycle. |
| **M10 Documents / Exports** | BLOCKED | project docs, versions, PDF/CSV/1C/bank/iCal/report/export, in-app signature paths | #320 native delivery; legal/provider status honesty; retention; authenticated archive; GP7. |
| **M11 Lifecycle / Recovery** | BLOCKED | archive/trash/restore concepts, offline queue, request ledgers in parts, outbox, reconciliation patterns | #315/#316/#317/#319; conflict/reversal matrix; stale cache; purge/retention; full history after closeout. |
| **M12 Platform / Operations** | BLOCKED | PostgreSQL/Redis/MinIO/API/Worker architecture, migrations, CI, readiness, review deployment | #425/#372/#389/#437/#247 lineage; staging, managed DR, observability, load, security acceptance, immutable release proof. |

## 5. Golden Paths — текущий acceptance verdict

Канонические определения остаются в `GOLDEN-PATHS.md`. Наличие отдельных service/API tests не повышает GP до PROVEN.

| GP | Результат | Статус сейчас | Главные блокеры |
|---|---|---|---|
| GP1 | Customer: object → rooms → estimate → budget | PARTIAL | review shell/browser, finance truth, complete create/edit/recovery proof |
| GP2 | Marketplace / lead / contractor selection | PARTIAL | #300 full scope, #315 context/session, capacity/source transitions |
| GP3 | Contractor: stages/schedule/work orders/progress | PARTIAL | remaining #316 mutations, scoped ACL, browser/mobile E2E |
| GP4 | Acceptance → rework → warranty | PARTIAL | unified E2E, closeout/warranty lifecycle, session/offline, evidence |
| GP5 | Invoice/payment/receipt/expense/refund | BLOCKED | financial truth, provider simulation/reconciliation, remaining replay paths |
| GP6 | Materials/select/purchase/delivery/receipt | PARTIAL | partial/return truth, post-commit UI, replay, scoped contractor flows |
| GP7 | Documents/signature/storage/export | BLOCKED | native file result, retention, provider/legal status, archive proof |
| GP8 | Chat/inbox/push/reminders | PARTIAL | #322 candidate only; #316/#317 remainder; native/export/session boundaries |

До финального релизного gate все GP1–GP8 должны стать **PROVEN** на одном immutable candidate SHA в требуемых средах.

## 6. 26 mutation families

Для каждой строки обязательно доказать: `create/command → authoritative read → counterpart read → recalculation/side effect → duplicate → response loss → offline → retry → conflict → reversal/cancel → history → ACL/session switch` в применимой части.

| # | Mutation family | Текущий статус |
|---:|---|---|
| 1 | Project create/update | PARTIAL |
| 2 | Participant/invite/access | PARTIAL |
| 3 | Room create/update/archive/restore | PARTIAL |
| 4 | Plan/design upload/version | PARTIAL |
| 5 | Estimate line create/update/delete | PARTIAL |
| 6 | Estimate proposal/lock/revision | PARTIAL |
| 7 | Change Order create/approve/reject | PARTIAL |
| 8 | Stage create/update/start/complete | PARTIAL |
| 9 | Work Order create/assign/status | BLOCKED |
| 10 | Schedule/dependency change | PARTIAL |
| 11 | Selection create/edit/propose/approve/reject | PARTIAL |
| 12 | Material quantity/source/availability | PARTIAL |
| 13 | Material approval | PARTIAL |
| 14 | Purchase create/status/cancel/return | PARTIAL |
| 15 | Receipt create/scan/verify | BLOCKED |
| 16 | Expense create/edit/remove | PARTIAL |
| 17 | Payment request/evidence/confirm/refund | BLOCKED |
| 18 | Chat thread lifecycle | PARTIAL |
| 19 | Chat message/reaction/read state | PARTIAL |
| 20 | Chat → Task | CANDIDATE PROVEN |
| 21 | Chat → Invoice | CANDIDATE PROVEN |
| 22 | Approval decision | PARTIAL |
| 23 | QC Issue lifecycle | PARTIAL |
| 24 | Acceptance/rework lifecycle | PARTIAL |
| 25 | Document upload/sign/export | BLOCKED |
| 26 | Closeout/archive/trash/restore/purge/warranty | BLOCKED |

`CANDIDATE PROVEN` в #20/#21 относится только к exact candidate #322 и не означает merge или закрытие всей family на `main`.

## 7. Обязательная adversarial matrix

Для каждого критического GP/mutation family проверять минимум:

- normal;
- validation/error;
- permission denial;
- stale data;
- offline before send;
- timeout before commit;
- commit + lost response;
- retry with same identity;
- duplicate double-tap;
- competing update;
- actor/project scope revocation during wait;
- account A→B→A;
- app/browser restart;
- reversal/cancel;
- archive/restore where applicable;
- history/evidence after terminal state.

## 8. Текущий приоритетный порядок

Приоритет пересчитывается при каждом новом P0/evidence change; нижележащая UX-задача не обгоняет security/data-integrity blocker.

### P0-A — восстановить канонический integration path

1. Owner decision/merge #425 после обязательного review.
2. Rebase/requalify stacked P0 candidates на новый `main`.
3. #389 backend image/security lineage.
4. #372 npm dependency remediation.
5. #437/#247 required-check trigger/protection integrity.

### P0-B — закрыть authority и cross-project data truth

6. #424 calendar child-resource ACL и все найденные sibling/cross-project IDOR класса.
7. Отдельно проверить estimate line, media/photo, documents, finance, chat, materials, work orders.

### P0-C — mutation recovery

8. Refresh/review/merge bounded #322.
9. Продолжить #316 по остальным 26 mutation families; не закрывать issue по двум chat commands.

### P0-D — session/offline/cache

10. #315 global session/account generation fence.
11. #317 transport classification, durable queue reachability, cache provenance.
12. Обязательные G04/G05-style offline/account-switch adversarial tests.

### P0-E — financial/calculation truth

13. #318 period allocation и portfolio facts.
14. Reconciliation: plan/obligation/actual/cash/forecast/refund/unknown facts.
15. Drill-down любой важной суммы до authoritative source/evidence.

### P0-F — review/browser usability gate

16. PR #367 review branch считать только evidence branch; устранить текущие browser blockers: manager-dashboard transition, contractor market estimate discoverability/contract, overlay pointer interception, tab aria-selected, contractor return-home state, object tab restoration.
17. Chromium + WebKit product smoke должны быть 100% green для customer и contractor на двух demo projects.
18. После этого расширять browser E2E до реальных GP, а не только surface/discoverability.

### P1-A — lifecycle closure

19. #319 purge/retention/full graph.
20. #320 native file/export.
21. #300 multi-contractor: полностью завершить либо fail-closed скрыть неподдерживаемые configuration paths до завершения.
22. Unified closeout→archive→warranty→history.

### P1-B — Human Usability Closure

23. Упростить Customer Home до status / needs-your-decision / 7-day / money / top-risk.
24. Contractor Home до today / overdue / blocked / waiting customer / ready-to-submit / money.
25. Один стабильный top-level map; schedule/time не теряется как второстепенный смысл.
26. Object: rooms / estimate / drawings-design / profile; setup readiness checklist только пока объект не готов.
27. Estimate обеим ролям: summary / lines / changes / documents.
28. Stage становится главным aggregate container tasks+materials+schedule+money+photos+issues+next-action.
29. Materials human lifecycle: нужно → согласовано → заказано → доставлено; `approved != ordered`.
30. Inbox = единый attention center; approvals — detail, chat — context/source, не второй source of truth.
31. Unified acceptance/issue/warranty cards.
32. Documents: project / finance / acceptance&warranty / archive; professional exports в advanced integrations.
33. Contextual quick actions вместо глобальной перегрузки.
34. Role-by-role friction retirement и accessibility matrix.

### P1-C — full E2E proof

35. GP1–GP8 API + mobile-web на canonical local runtime PostgreSQL/Redis/MinIO/API/Worker.
36. Customer×contractor concurrent proof.
37. Offline/slow network/conflict/reversal/account-switch pass.
38. Deterministic review seed с минимум двумя насыщенными объектами.

### P2 / external production readiness

39. Постоянный staging / exact-artifact promotion.
40. Managed backup/PITR restore drill, измеренный RPO/RTO.
41. Observability alert→delivery→ACK→recovery.
42. Load/ramp/spike/soak.
43. Independent security/pentest/legal/privacy.
44. Real provider acceptance only where release scope требует provider.
45. Controlled pilot/support/incident runbook.

## 9. Priority resolver

Перед началом любого нового прохода приоритет определяется заново:

1. **Security / data isolation / money corruption risk**.
2. **Exactly-once / atomicity / recovery / reversal**.
3. **Session / account / offline / cache truth**.
4. **Calculation / reconciliation truth**.
5. **Canonical browser/native navigation and accessibility blockers**.
6. **Lifecycle closure / multi-party scope**.
7. **Human usability / friction / terminology**.
8. **External readiness**.
9. **Новые функции** — только после закрытия core PARTIAL/BLOCKED или отдельного owner decision.

Новый подтверждённый P0 автоматически поднимается выше P1 независимо от старого порядка roadmap. Это изменение должно в той же logical change отразиться в master spec, этом board и roadmap.

## 10. Что запрещено считать прогрессом

Не повышают статус сами по себе:

- новый экран;
- новый endpoint;
- `200 OK`;
- enum/status;
- unit test без полного business result;
- статический inventory;
- demo/simulated external action, выданный за production;
- зелёный старый CI после изменения SHA;
- success одного браузера вместо required matrix;
- отсутствие ошибки вместо доказанного результата;
- скрытие/удаление failing assertion без доказательства изменения контракта.

## 11. Правило синхронизации

До начала любой задачи агент обязан сверить:

1. текущий `main` SHA;
2. migration head;
3. открытые P0/P1 issues;
4. open/draft/stacked PR и их exact heads;
5. последние применимые CI/deployed smoke;
6. `PRODUCTION-READINESS.md`;
7. master ТЗ;
8. этот Completion Board;
9. `CHANGELOG-ROADMAP.md`;
10. затрагиваемые domain contracts/calculation/screen catalogs.

После изменения behavior/evidence/status обновление этих документов происходит в той же logical change. Если код и документ расходятся, статус понижается до фактически доказанного уровня; документ не используется для «победы» над runtime evidence.

## 12. Финальный gate

RENOVA может называться функционально готовой только когда на одном immutable candidate:

- нет открытых launch-blocking P0 product-integrity/security defects;
- GP1–GP8 = PROVEN;
- critical mutation families = PROVEN;
- customer+contractor browser matrix = green;
- required iOS/Android key paths = green;
- session/account isolation = PROVEN;
- offline/retry/reversal = PROVEN;
- finance/calculation reconciliation = PROVEN;
- migrations/restore = PROVEN;
- closeout/archive/warranty/history = PROVEN;
- external unavailable capabilities честно отмечены `FUTURE EXTERNAL`, а не DONE;
- release evidence привязан к exact SHA и не меняется после квалификации без нового прогона.
