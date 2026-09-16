# RENOVA — Product Completion Board

**Статус:** ACTIVE / AUTHORITATIVE EXECUTION BOARD  
**Tracking:** #463 / PR #464  
**Дата последней полной сверки:** 2026-09-16  
**Канонический `main` на момент сверки:** `e5c6ee44c0f684b14037e77948dbcb630fd41896`  
**Schema head канонического `main`:** `w22projectparticipants01`  
**Цель:** одна честная карта того, что уже интегрировано, что доказано только на exact candidate, что частично, что заблокировано и что делать следующим.

Этот Board — оперативный слой живого ТЗ. `docs/RENOVA-TECHNICAL-SPECIFICATION.md` остаётся системным паспортом и продуктовым контрактом; `PRODUCT-COMPLETION-MANDATE.md` остаётся каталогом мандатных задач A1–E4 и их acceptance; `GOLDEN-PATHS.md` определяет GP1–GP8; этот документ определяет **текущий фактический статус и порядок интеграции на основании реального `main`, открытых PR и evidence**.

Если статический план конфликтует с более новым подтверждённым P0/evidence, порядок меняется здесь и в `CHANGELOG-ROADMAP.md`; acceptance-критерий при этом не ослабляется.

---

## 0. Completion invariant

RENOVA является PRODUCT COMPLETE только когда применимый пользовательский путь замыкается без разрыва истины:

`создал → authoritative read → изменил/перевёл → вторая сторона увидела → связанные расчёты/модели пересчитались → ошибся/отменил → восстановил/согласовал → потерял ответ/сеть → безопасно повторил → сменил аккаунт/проект → чужое не утекло → завершил объект → история/документы/гарантия сохранились`.

Наличие экрана, кнопки, endpoint, enum, `200 OK`, unit test, source inventory или отдельного зелёного PR само по себе не закрывает lifecycle.

### Единственные допустимые readiness states

| Status | Meaning |
|---|---|
| `PROVEN` | Поведение интегрировано в канонический `main` и доказано на требуемом exact-main runtime/layer. |
| `CANDIDATE PROVEN` | Exact-head кандидат доказывает только заявленный bounded-контур, но ещё не интегрирован в `main`. |
| `PARTIAL` | Capability существует или часть цепочки проверена, но полный результат/негативные сценарии не доказаны. |
| `BLOCKED` | Известный дефект/зависимость/отсутствующий gate не позволяет безопасно принять результат. |
| `FUTURE EXTERNAL` | Внутренний контракт может быть готов, но итог требует реальной внешней среды/provider/device/administrative evidence. |

**Open PR никогда не становится `PROVEN`.** Два зелёных PR на разных bases не складываются в один зелёный продуктовый SHA.

---

## 1. Правило актуальности и источники истины

Перед любой новой задачей или изменением приоритета агент обязан сверить, в указанном порядке:

1. текущий `main` SHA и migration head;
2. открытые P0/P1 issues;
3. открытые/draft/stacked PR, их base/head SHA и зависимости;
4. последние применимые CI runs и exact-head artifacts;
5. deployed/review smoke, если задача касается доступного пользователю стенда;
6. `PRODUCTION-READINESS.md` и readiness evidence;
7. этот Board;
8. master-ТЗ;
9. `CHANGELOG-ROADMAP.md`;
10. применимые domain/calculation/screen contracts.

### Freshness rule

- Evidence привязано к **точному SHA**.
- После rebase/merge/change SHA старое evidence не переносится автоматически.
- Если документ говорит «готово», а runtime/CI говорит иначе, статус немедленно понижается до фактически доказанного.
- Если новый P0 выше текущей работы по security/data/money/recovery risk, execution order пересчитывается; старый roadmap не имеет права удерживать более низкий приоритет.
- Любой PR, который меняет behavior, evidence или readiness хотя бы одной строки M/GP/F/Wave, обновляет этот Board в той же logical change либо явно пишет `Board status unchanged` с обоснованием.

### Priority resolver

1. Security / cross-project or cross-account isolation / destructive money corruption.
2. Atomicity / exactly-once / response-loss / rollback / reversal.
3. Session / account / offline / cache truth.
4. Financial / calculation / reconciliation truth.
5. Canonical browser/native navigation and accessibility blockers.
6. Lifecycle closure / multi-party scope.
7. Human usability / friction / terminology.
8. External production readiness.
9. New product capabilities — только после core closure либо отдельного owner decision.

---

## 2. Текущая общая правда

| Контур | Статус | Фактическая граница доказательства |
|---|---|---|
| Канонический `main` | `PARTIAL` | `e5c6ee44…`; продукт широк, но несколько более новых bounded fixes существуют только в открытых кандидатах. |
| Broad production | `BLOCKED` | Security/data/recovery/session/finance/browser/native/external gates не закрыты на одном SHA. |
| M01–M12 | `PARTIAL/BLOCKED` | Ни один полный mode lifecycle не доказан end-to-end на текущем `main`. |
| GP1–GP8 | `PARTIAL/BLOCKED` | Ни один GP не может быть повышен до `PROVEN`; интегрированный GP1 #458 ещё не квалифицирован. |
| Review role/project entry | `CANDIDATE PROVEN` | Deployed run `35084701908`: четыре role×project entry сценария прошли. |
| Deployed mutation proof | `CANDIDATE PROVEN` | В том же run `deployed-mutation-proof` = SUCCESS. Это не полный UI-E2E. |
| Deployed product browser | `BLOCKED` | Chromium и WebKit product jobs FAILED; Chromium: 4 passed / 6 failed. |
| Реальные providers | `FUTURE EXTERNAL` | Live payments/SMS/e-sign/FNS/Kontur/Goskey не выдаются за внутреннюю product-complete evidence. |

### Review/browser defects, подтверждённые run `35084701908`

1. Customer: переход в `Управленческая сводка` не дал ожидаемого visible destination state.
2. Contractor: после Budget не найден ожидаемый entry `Рыночная оценка` по текущему browser contract.
3. Customer shell: overlay перехватывает pointer events и блокирует `Главная`.
4. Customer Object: вкладка `Комнаты` не выставляет ожидаемый `aria-selected="true"`.
5. Contractor shell: возврат Home не восстанавливает `os-home-ready`.
6. Contractor Object: `Комнаты` не доступна/не видна по текущему contract.

На review branch установка зависимостей в этом deployed run сообщала `22 vulnerabilities (15 moderate, 7 high)`. Это truth именно review lineage; отдельно #372 имеет квалифицированный bounded dependency candidate, но он не делает #367 автоматически безопасным.

**Следствие:** review stand пригоден для ограниченного ознакомления и evidence, но не является acceptance-ready и тем более production-ready.

---

## 3. Mode Board — M01–M12

| Mode | Required closed chain | Main | Best candidate | Dominant gap |
|---|---|---|---|---|
| M01 Self-managed | object → estimate → plan/work → materials → expenses/docs → closeout | `PARTIAL` | `PARTIAL` | Нет one-SHA lifecycle через recovery/closeout. |
| M02 One contractor | invite/lead → participant → work → acceptance → money/docs → warranty | `PARTIAL` | `PARTIAL` | Bounded slices не собраны в один lifecycle. |
| M03 Multi-contractor | principals → scoped work/finance/docs/chat → customer aggregate | `BLOCKED` | `BLOCKED` | #300/#344/#345. |
| M04 Contractor with team | principal commercial authority → subordinate execution | `PARTIAL` | `PARTIAL` | Commercial/execution authority не закрыта во всех domains. |
| M05 Direct invite | invite → identity → participant/scope → ordinary lifecycle | `PARTIAL` | `PARTIAL` | Invite/revoke/recovery не квалифицированы целиком. |
| M06 Marketplace | lead → quotes → choose → participant conversion → lifecycle | `BLOCKED` | `BLOCKED` | Multi-contractor participant truth. |
| M07 Technical supervision | supervisor → inspect → issue → remediation → decision | `PARTIAL` | `PARTIAL` | Нет полного role-rights E2E. |
| M08 Viewer/guest | bounded share/read → revoke → stale-link denial | `PARTIAL` | `PARTIAL` | Revocation/file/session lifecycle. |
| M09 Portal-token | token → canonical action → replay/revoke/expiry | `PARTIAL` | `PARTIAL` | Нет полного token lifecycle. |
| M10 Closed/warranty | complete → archive/export → warranty → claim closure | `BLOCKED` | `BLOCKED` | #319 + disconnected closeout/warranty/history. |
| M11 Unstable network | offline/cache → exact intent → response-loss replay → reconcile | `BLOCKED` | `PARTIAL` | #316/#317; несколько bounded candidates уже доказаны, family-wide closure нет. |
| M12 Account switch | A work → logout/B → no A publication/replay → A2 | `BLOCKED` | `BLOCKED` | #315; #428 только logout revoke. |

---

## 4. Golden Path Board — GP1–GP8

| GP | Result | Main | Best candidate | Dominant blocker |
|---|---|---|---|---|
| GP1 | Project → Rooms → Estimate → Budget | `BLOCKED` | `PARTIAL` | #458 pending; #457/#448 bounded; #412 create recovery ещё PARTIAL; browser shell. |
| GP2 | Marketplace → Quotes → Contractor | `BLOCKED` | `BLOCKED` | #300/#344/#345; #429 только client foundation. |
| GP3 | Stages → Schedule → WorkOrder → Evidence → Progress | `BLOCKED` | `PARTIAL` | participant scope, #316, calendar/object binding, browser/mobile E2E. |
| GP4 | Acceptance → Rework → Portal → Warranty | `PARTIAL` | `PARTIAL` | closeout/warranty/portal/session не соединены. |
| GP5 | Invoice → Payment → Receipt → Expense → Refund | `BLOCKED` | `PARTIAL` | simulated payment lifecycle, finance truth, replay/offline. |
| GP6 | Material → Approval → Purchase → Delivery → Receipt | `PARTIAL` | `PARTIAL` | #460 material-needs proven bounded; purchase/delivery/return/finance family остаётся. |
| GP7 | Document → Version → Sign → Export/Archive | `BLOCKED` | `PARTIAL` | #320 native delivery, retention, provider/legal truth. |
| GP8 | Chat → Inbox/Push → Read → Reminder | `PARTIAL` | `PARTIAL` | #315/#316/#317; #322 strong bounded, chat thread/stage-comment family не полностью integrated. |

**Promotion rule:** GP становится `PROVEN` только когда его API + mobile-web сценарии зелёные на одном exact integrated SHA на canonical PostgreSQL + Redis + MinIO + API + Worker. Отдельные component/surface tests GP не повышают.

---

## 5. Mutation Board — exact 26 mutating mobile surfaces

Источник inventory: #431 / PR #432. Это **25 business modules + `client.ts` transport/session owner**. Нельзя подменять этот executable inventory произвольными 26 объектами.

Для каждой поверхности при окончательной приёмке применимая цепочка:

`intent → create/transition → authoritative read → counterpart read → linked recalculation/effect → validation/ACL error → offline/timeout → commit+lost response → same-intent retry → changed-payload conflict → competing write → reversal/cancel → history → account/project switch`.

| ID | Surface | Main | Best candidate | Current boundary |
|---|---|---|---|---|
| F01 | `admin.ts` | `PARTIAL` | `PARTIAL` | Team/invite/subscription/operator paths не один lifecycle. |
| F02 | `auth.ts` | `BLOCKED` | `PARTIAL` | #428 logout revoke bounded; #315 generation isolation open. |
| F03 | `calendar.ts` | `BLOCKED` | `PARTIAL` | #424 child binding bounded-proven; #461 iCal atomic/replay evidence pending. |
| F04 | `chats.ts` | `BLOCKED` | `PARTIAL` | #322 task/invoice bounded-proven; #385/#387 strong stacked slices; #392 remains PARTIAL; #317. |
| F05 | `design.ts` | `PARTIAL` | `CANDIDATE PROVEN` | #414 bounded design create replay proven; submit/decision/file lifecycle not closed. |
| F06 | `documents.ts` | `BLOCKED` | `PARTIAL` | No one-SHA version/sign/export/native lifecycle; #320. |
| F07 | `estimate.ts` | `BLOCKED` | `PARTIAL` | #444 binding, #448 Change Order, #457 reversible removal bounded-proven; #412 create replay remains PARTIAL. |
| F08 | `floor.ts` | `BLOCKED` | `PARTIAL` | #441 still PARTIAL until required PostgreSQL evidence/integration. |
| F09 | `issues.ts` | `PARTIAL` | `CANDIDATE PROVEN` | #418/#459 bounded issue-create replay proven; transitions/close/reversal family not closed. |
| F10 | `market.ts` | `BLOCKED` | `BLOCKED` | Final conversion/sibling scope depends #300/#344/#345. |
| F11 | `materials.ts` | `BLOCKED` | `CANDIDATE PROVEN` | #460/#465 bounded material-needs replay proven; broader purchase/supply/reversal + #317 remain. |
| F12 | `misc.ts` | `PARTIAL` | `PARTIAL` | Viewer/portal/revoke/expiry not one lifecycle. |
| F13 | `notifications.ts` | `PARTIAL` | `PARTIAL` | Source entity + #315 cross-account publication truth. |
| F14 | `os.ts` | `PARTIAL` | `PARTIAL` | Analytics/read models depend participant/finance/session truth. |
| F15 | `payments.ts` | `BLOCKED` | `PARTIAL` | Payment/provider/expense/refund lifecycle not fully connected; #322 invoice is not payment truth. |
| F16 | `projects.ts` | `BLOCKED` | `PARTIAL` | #434 reversible lifecycle bounded; #319 purge, #300 participant scope. |
| F17 | `receipts.ts` | `BLOCKED` | `PARTIAL` | #317 and finance/material actual truth; #382 formula candidate does not close receipt family. |
| F18 | `rooms.ts` | `PARTIAL` | `PARTIAL` | #438/#440 bounded; connected authority/derived truth pending #458. |
| F19 | `scratchpad.ts` | `PARTIAL` | `PARTIAL` | No connected lifecycle evidence. |
| F20 | `selections.ts` | `PARTIAL` | `CANDIDATE PROVEN` | #416 bounded selection-create replay proven; propose/approve/reject side effects still not family-wide proven. |
| F21 | `stages.ts` | `BLOCKED` | `PARTIAL` | #452 child ACL bounded-proven; #404 replay remains PARTIAL. |
| F22 | `technicalSupervision.ts` | `PARTIAL` | `PARTIAL` | assignment→finding→remediation→decision not closed. |
| F23 | `workAcceptances.ts` | `PARTIAL` | `PARTIAL` | Acceptance exists; portal/warranty/offline/retry not one proof. |
| F24 | `workOrders.ts` | `BLOCKED` | `PARTIAL` | #383 bounded evidence but not comparable integrated qualification. |
| F25 | `workSchedule.ts` | `BLOCKED` | `BLOCKED` | #420/#316 replay policy; no qualified full family. |
| F26 | `client.ts` | `BLOCKED` | `PARTIAL` | Infrastructure owner; #315/#317 global blockers, #387 is only bounded queue-dedupe prerequisite. |

---

## 6. Exact-candidate evidence ledger

### `CANDIDATE PROVEN` — bounded evidence only

| Candidate | Exact-head / evidence boundary | Что реально доказано | Что НЕ доказано |
|---|---|---|---|
| #425 | `9984e7bf…` | required-check/bootstrap + canonical local runtime source | Product recovery/UX, live ruleset. |
| #389 | `a32c554…` on #425 lineage | fixed PCRE2 backend-image gate | npm, product behavior. |
| #372 | `6d6ef7e…` on #425 lineage | bounded npm lock remediation | review #367 lineage и future dependencies. |
| #437 | `5c2a6bb…` on #425 lineage | required PR-context scheduling | live repository settings. |
| #450 | `ed8b602…` on #425 lineage | bounded canonical registry-pull retry | External registry uptime. |
| #424 | `a21f76a…` | calendar stage child/project binding | iCal atomicity/replay. |
| #452 | `709c2d0…` | stage reaction child binding | reaction offline replay family. |
| #444 | `bc52758…` | estimate-line PATCH path/object binding | create/reversal/full estimate. |
| #455 | `0859c47…` | project-media current project ACL | chat-media/thread ACL, purge/native. |
| #456 | `bbebaa9…` on #455 | chat attachment current thread ACL | storage retention/native export. |
| #322 | `582fd727…`; qualified merge context `76d63052…` | chat invoice/task atomic command + safe replay | all #316 mutations, #315/#317, provider/payment truth. |
| #414 | `54025fb…` stacked | design-package create response-loss/replay primitive | submit/approve/reject/native file lifecycle. |
| #416 | `ddf7c208…` stacked | selection create response-loss/replay primitive | decision/material side effects family. |
| #418/#459 | candidate `4b93a0de…`; CI `35097643070` | issue-create atomic replay + PG authority/race + mobile restart | issue transition/escalate/close. |
| #460/#465 | candidate `83199215…`; CI `35099288980`; PG `35099289096` | material-needs atomic replay + PG authority/race + mobile restart | procurement lifecycle. |
| #448 | `2df6e660…` | Change Order approve/reject/replay/conflict and linked budget/document effects | GP1/full finance. |
| #457 | `c8120c17…`; candidate schema `w23estimatelifecycle01` | reversible estimate-line remove/restore on qualification base | canonical-main schema remains w22; GP1 not promoted. |
| #382 | `953a821…` | sum-preserving period allocation + unavailable category fact | whole finance ledger/provider lifecycle. |
| #426 | bounded candidate | simulated fiscal/NPD ports | real FNS/NPD and GP5/GP6. |
| #367 deployed | `0d58416…`, run `35084701908` | role/project entry + deployed mutation proof | full browser UX; Chromium/WebKit are red. |

### `PARTIAL` / still blocked despite useful evidence

- #383 direct WorkOrder replay — PG evidence useful, integrated comparable qualification absent.
- #385 chat reaction replay — useful stacked evidence; family and integration remain.
- #387 intent-aware offline dedupe — important prerequisite, not global #316/#317 closure.
- #392 chat-thread replay — raw-stack count mismatch; remains PARTIAL.
- #404 stage-comment replay — bounded evidence, remains PARTIAL pending refreshed integration.
- #412 estimate-line create replay — bounded PG/mobile evidence, remains PARTIAL pending #322 integration/requalification.
- #441 floor-plan child binding — required PostgreSQL qualification not fully wired at reported cut.
- #461 iCalendar atomic/replay — exact-head evidence pending.
- #458 integrated GP1 — explicitly `Chain verified: Pending`.
- #408 truthful materials mutation outcome UX — design/source repair exists, exact qualification must be read before promotion.
- #391/#393/#395/#397/#403/#405/#407/#410/#411 — bounded UX/accessibility/navigation candidates; old-base or pending evidence, not product-complete claims.
- #429 participant API client — foundation only, no full participant UX/scope adoption.
- #428 logout revoke — one session slice only.

---

## 7. Integration DAG — текущий порядок

### Wave 0 — trustworthy integration foundation

1. Owner review/merge **#425**.
2. Rebase/requalify on resulting `main`: **#389**, **#372**, **#437**, **#450**.
3. Проверить/исправить live repository protection/ruleset under **#247**; source CI не заменяет admin evidence.
4. После каждого merge пересчитать downstream base/head и не переносить stale CI.

### Wave 1 — security/data authority

5. Rebase/requalify **#444**, **#424**, **#452**, затем floor child binding **#441** после обязательного PG proof.
6. Rebase/requalify **#455 → #456**.
7. Выполнить sibling/cross-project negative scan для estimate/media/documents/finance/chat/materials/work/schedule; новые confirmed P0 поднимаются в эту Wave.
8. Rebase/requalify finance truth candidates **#381/#382** и связанные producers; explicit zero ≠ missing.

### Wave 2 — replay/atomicity

9. Refresh/review/integrate **#322** первым — это prerequisite recovery tree.
10. Rebase exact #322 children на новый `main`; ни один raw stacked count не считается интеграцией.
11. Early cross-cutting recovery: **#387**, затем mutation-specific slices.
12. Интегрировать только после exact qualification: #385, #383, #392, #404, #412, #414, #416, #418, #460; затем квалифицировать #461.
13. Повторить executable #431 inventory и закрыть **#316 только когда ни одна reachable mutation не остаётся unsafe**.

### Wave 3 — global session/offline/cache

14. Закрыть **#315**: generation fence для request/token/storage/navigation/cache/inbox/queue/files; A→B→A и project1→project2.
15. Закрыть **#317**: transport taxonomy, durable enqueue reachability, per-resource cache provenance/as-of.
16. Airplane/restart/reconnect + delayed-response + account-switch matrix по всем queued families.

### Wave 4 — first connected lifecycle / GP1

17. Requalify #434 project lifecycle.
18. Requalify #438/#440 rooms and consume server authority in UI.
19. Integrate #444/#412/#457 estimate lifecycle + #448 Change Order + #382 budget truth on same lineage.
20. Пересобрать **#458** и доказать GP1 API + mobile-web на одном SHA.
21. Не переходить к «полировке GP1» пока linked budget/second-side/retry/reversal не сходятся.

### Wave 5 — participants / GP2 / GP3

22. Закрыть **#300/#344/#345** across stages/schedule/workorders/chat/notifications/documents/materials/expenses/payee.
23. Завершить participant UX после #429; не оставлять API-only capability как готовый продукт.
24. Two/three-contractor sibling negatives + customer aggregate truth.
25. Connect GP2 and GP3 API + mobile-web.

### Wave 6 — lifecycle closure edges

26. **#319** purge/retention/storage full graph.
27. **#320** authenticated native file save/share после #315.
28. Unified closeout → archive/history → warranty → warranty closure.
29. M07 supervisor, M08 viewer/revoke, M09 portal-token.
30. Simulated provider lifecycle A3/A4/remaining adapters только для internal PRODUCT COMPLETE; real providers не активировать автоматически.

### Wave 7 — Human Usability Closure

Эта Wave не расширяет feature scope. Она удаляет трение и неоднозначность после/параллельно P0 integrity там, где изменения не маскируют truth defects.

31. Customer Home: `статус → нужно решить → 7 дней → план/факт/прогноз → главный риск`.
32. Contractor Home: `сегодня → просрочено → заблокировано → ждёт заказчика → готово к сдаче → деньги`.
33. Стабильная top-level navigation; автоматическое phase-driven переставление Dock не должно ломать learned positions.
34. Object: `Комнаты / Смета / Чертежи и дизайн / Данные объекта`; setup-readiness checklist только до готовности.
35. Estimate обеим ролям: `Сводка / Позиции / Изменения / Документы`; user-facing Change Order = `Дополнительные работы`.
36. Stage = aggregate container: задачи, материалы, сроки, деньги, фото, issues, next action.
37. Materials lifecycle: `Нужно → Согласовано → Заказано → Доставлено`; **approved ≠ ordered**. Allowance показывать как понятный лимит/дельту бюджета.
38. Schedule views: `Сегодня / 2 недели / Весь ремонт`; задержка всегда объясняет причину.
39. Inbox = единый attention center; Approvals = detail; Chat = context/source, не второй source of truth.
40. Unified acceptance/issue/warranty cards; явные role actions (`Сдать этап`, `Принять`, `Вернуть`, `Исправлено`, `Подтвердить исправление`).
41. Documents: `Проект / Финансы / Приёмка и гарантия / Архив`; 1С/bank/iCal/technical export — advanced integrations.
42. Contextual quick actions, не перегруженный глобальный FAB.
43. Полный accessibility/navigation pass: focus, aria-selected, screen reader, keyboard, modal cleanup, 44×44, disabled/busy, contrast, no color-only state.
44. Role-by-role friction retirement: clicks to first useful action, screen hops, manual fields, hidden gestures, remembered context.

### Wave 8 — one immutable PRODUCT COMPLETE candidate

45. GP1–GP8 API + mobile-web на canonical PostgreSQL + Redis + MinIO + API + Worker.
46. Customer×contractor concurrent run.
47. Slow network/offline/response-loss/conflict/reversal/account-switch run.
48. Browser matrix Chromium + WebKit 100% green; ключевые native iOS/Android paths green.
49. Deterministic review seed минимум из active и near-closeout объектов.
50. Exact SHA freezes; любое изменение создаёт новый candidate и требует affected requalification.
51. Release Evidence Pack = Board + GP results + mutation inventory + calculations + security + migrations + restore + device/browser + provider truth + known external limitations.

### Wave 9 — external production qualification

52. Persistent staging / exact artifact promotion.
53. Managed backup/PITR restore drill and measured RPO/RTO.
54. Observability alert→delivery→ACK→recovery.
55. Load/ramp/spike/soak.
56. Independent security/pentest/legal/privacy.
57. Real provider acceptance only for approved release scope.
58. Controlled pilot/support/incident runbook.

---

## 8. Как выбирать следующую работу

На старте каждого прохода:

1. Обновить evidence cut.
2. Выбрать первую Wave с `BLOCKED` P0, которую реально можно продвинуть без незакрытого prerequisite.
3. Внутри Wave выбрать самый маленький bounded контур, который закрывает lifecycle cell, а не добавляет экран/файл.
4. Если dependency требует owner merge/review — не обходить её; брать независимую задачу того же или более высокого риска.
5. После exact CI обновить candidate status.
6. После merge обновить main status и заставить descendants rebase/requalify.
7. Если новая находка делает прежний план неверным — изменить план, а не защищать старую очередь.

**На текущем evidence cut следующий integration-critical шаг — owner review/merge #425.** После него — rebase/requalification #389/#372/#437/#450; затем Wave 1 security/data authority. Recovery tree #322 остаётся P0, но его безопасная интеграция должна происходить на уже восстановленном trusted main lineage.

---

## 9. Что не считается прогрессом

Не повышают readiness сами по себе:

- новый экран/кнопка/endpoint;
- скрытие failing assertion;
- изменение expected value на текущее отображаемое значение;
- success одного браузера вместо required matrix;
- SQLite вместо требуемого PostgreSQL race proof;
- source existence вместо user result;
- candidate на stale base;
- simulated provider, названный production;
- cache, выданный за fresh;
- отсутствие ошибки, выданное за успешный commit;
- «0» вместо unknown;
- merge foundation, выданный за закрытие parent cross-domain issue.

---

## 10. Final PRODUCT COMPLETE gate

Claim разрешён только когда одновременно на одном exact integrated SHA:

1. Нет открытых launch-blocking P0 product/security/data defects.
2. GP1–GP8 = `PROVEN` API + mobile-web.
3. M01–M12 имеют tested disposition; M03/M11/M12 не waived.
4. Все critical mutation surfaces имеют normal/error/retry/reversal/session evidence.
5. Same-intent response-loss не дублирует бизнес-факт; changed intent конфликтует там, где требуется.
6. Authority проверяется на canonical object и после lock wait, где применимо.
7. Second-side visibility, calculations, audit/outbox/worker effects сходятся после commit.
8. Session/account switch не публикует/исполняет старый account/project truth.
9. Multi-contractor sibling isolation + customer aggregate proven.
10. Plan/revised/obligation/actual/payment/receipt/refund/unknown не подменяют друг друга.
11. Media/document bytes наследуют current authority owning object/thread.
12. Archive/trash/restore/purge и closeout/warranty/history доказаны.
13. Chromium/WebKit + required native paths green.
14. Migrations + backup/restore required internal evidence green.
15. Candidate evidence rerun after every prerequisite integration.
16. `FUTURE EXTERNAL` явно остаётся внешним и не изображается operational.
17. Release evidence привязан к immutable SHA; после изменения SHA статус пересчитывается.

После этого оставшееся `FUTURE EXTERNAL` — уже deployment/provider qualification, а не незакрытый внутренний продукт RENOVA.
