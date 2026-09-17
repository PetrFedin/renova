# RENOVA — Product Completion Board

**Статус:** ACTIVE / AUTHORITATIVE EXECUTION BOARD  
**Tracking:** #463 / PR #464  
**Дата последней полной сверки:** 2026-09-17  
**Канонический `main` на момент сверки:** `e5c6ee44c0f684b14037e77948dbcb630fd41896`  
**Schema head канонического `main`:** `w22projectparticipants01`  
**Цель:** одна честная карта того, что уже интегрировано, что доказано только на exact candidate, что частично, что заблокировано и что делать следующим.

Этот Board — оперативный слой живого ТЗ. `docs/RENOVA-TECHNICAL-SPECIFICATION.md` остаётся системным паспортом и продуктовым контрактом; `PRODUCT-COMPLETION-MANDATE.md` остаётся каталогом A1–E4 и acceptance; `GOLDEN-PATHS.md` задаёт GP1–GP8; этот Board определяет **текущий фактический статус, evidence cut и порядок интеграции**.

Если статический план конфликтует с более новым подтверждённым P0/evidence, порядок меняется здесь и в `CHANGELOG-ROADMAP.md`; acceptance при этом не ослабляется.

---

## 0. Completion invariant

RENOVA является PRODUCT COMPLETE только когда применимый пользовательский путь замыкается без разрыва истины:

`создал → authoritative read → изменил/перевёл → вторая сторона увидела → связанные расчёты пересчитались → ошибся/отменил → восстановил/согласовал → потерял ответ/сеть → безопасно повторил → сменил аккаунт/проект → чужое не утекло → завершил объект → история/документы/гарантия сохранились`.

Наличие экрана, endpoint, `200 OK`, unit test, source inventory или отдельного зелёного PR само по себе lifecycle не закрывает.

### Единственные допустимые readiness states

| Status | Meaning |
|---|---|
| `PROVEN` | Поведение интегрировано в канонический `main` и доказано на требуемом exact-main runtime/layer. |
| `CANDIDATE PROVEN` | Exact-head кандидат доказывает только заявленный bounded-контур, но ещё не интегрирован в `main`. |
| `PARTIAL` | Capability существует или часть цепочки проверена, но полный результат/негативные сценарии не доказаны. |
| `BLOCKED` | Известный дефект/зависимость/отсутствующий gate не позволяет безопасно принять результат. |
| `FUTURE EXTERNAL` | Внутренний контракт может быть готов, но итог требует реальной внешней среды/provider/device/administrative evidence. |

**Open PR никогда не становится `PROVEN`.** Несколько зелёных PR на разных bases не складываются в один зелёный продуктовый SHA.

---

## 1. Правило актуальности и источники истины

Перед новой задачей или изменением приоритета агент обязан сверить:

1. текущий `main` SHA и migration head;
2. открытые P0/P1 issues;
3. open/draft/stacked PR, их base/head SHA и зависимости;
4. последние применимые CI runs и exact-head artifacts;
5. deployed/review smoke для пользовательских стендов;
6. `PRODUCTION-READINESS.md`;
7. этот Board;
8. master-ТЗ;
9. `CHANGELOG-ROADMAP.md`;
10. затрагиваемые domain/calculation/screen contracts.

### Freshness rule

- Evidence принадлежит **точному SHA**.
- После rebase/merge/change SHA старый green не переносится автоматически.
- Runtime/CI сильнее документа: при конфликте статус понижается до фактического evidence.
- Новый P0 security/data/money/recovery может изменить execution order; старый roadmap не имеет приоритета над новым подтверждённым риском.
- Behavior/evidence/readiness change обновляет Board в той же logical change либо явно фиксирует `Board status unchanged`.
- Source scan должен проверять **канонически зарегистрированный runtime path**, а не объявлять дефект по наличию legacy/dead code. #477 закрыт именно по этому правилу как false positive.

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
| Канонический `main` | `PARTIAL` | `e5c6ee44…`; сегодняшние security/governance исправления существуют только в открытых кандидатах. |
| Broad production | `BLOCKED` | Security/data/recovery/session/finance/browser/native/external gates не закрыты на одном SHA. |
| M01–M12 | `PARTIAL/BLOCKED` | Ни один полный mode lifecycle не доказан end-to-end на текущем `main`. |
| GP1–GP8 | `PARTIAL/BLOCKED` | Ни один GP не повышен до `PROVEN`; candidate slices не заменяют one-SHA lifecycle. |
| Trusted integration foundation | `BLOCKED` | #425 source/check lineage квалифицирован; merge блокирует живое independent-review topology под #247. |
| Required-check contamination | `CANDIDATE PROVEN` | Cancelled child-push suite на SHA #425 восстановлен 8/8; #437 предотвращает повторение на exact `63dd6b0…`. |
| Wave-1 data authority | `PARTIAL` | #441 и #473 bounded-proven; #476 проходит exact-head qualification; другие P0 остаются candidate-only. |
| Review role/project entry | `CANDIDATE PROVEN` | Deployed run `35084701908`: четыре role×project entry сценария прошли. |
| Deployed mutation proof | `CANDIDATE PROVEN` | В том же run `deployed-mutation-proof` = SUCCESS. Это не полный UI-E2E. |
| Deployed product browser | `BLOCKED` | Chromium и WebKit product jobs FAILED; Chromium 4 passed / 6 failed. |
| Реальные providers | `FUTURE EXTERNAL` | Live payments/SMS/e-sign/FNS/Kontur/Goskey не выдаются за internal product-complete evidence. |

### Review/browser defects — последний подтверждённый deployed cut

Run `35084701908` остаётся действующим deployed evidence до нового полного прогона:

1. Customer: `Управленческая сводка` не дала ожидаемый visible destination state.
2. Contractor: после Budget не найден ожидаемый entry `Рыночная оценка`.
3. Customer shell: overlay перехватывает pointer events и блокирует `Главная`.
4. Customer Object: `Комнаты` не выставляет ожидаемый `aria-selected="true"`.
5. Contractor shell: возврат Home не восстанавливает `os-home-ready`.
6. Contractor Object: `Комнаты` не видна по текущему contract.

Review stand пригоден для ограниченного ознакомления/evidence, но не является acceptance-ready или production-ready.

### Wave-0 governance truth на 2026-09-17

- #425 exact source SHA `9984e7bf…` остаётся первым integration node.
- Direct merge был честно отклонён ruleset: требовался independent approval последнего push; ранее дополнительно отображались 8 cancelled core contexts.
- Root cause cancelled contexts доказан: stacked child branch создал `push` CI run `34971896375` на **родительском SHA #425**, затем новый child push отменил этот run; GitHub видел более новые cancelled contexts на parent commit.
- Этот exact cancelled suite был rerun **без изменения source SHA**; все 8 core jobs теперь SUCCESS.
- #437 exact `63dd6b0…` предотвращает повторение: core CI запускается на `pull_request` и `push` только для `main`; bounded evidence зелёный.
- Remaining #425 blocker: live ruleset требует Code Owner review + approval кем-то кроме last pusher; bypass actors отсутствуют, текущий CODEOWNER/author identity совпадает. Это owner-side administrative prerequisite, его нельзя обходить self-approval или ослаблением required checks.

---

## 3. Mode Board — M01–M12

| Mode | Required closed chain | Main | Best candidate | Dominant gap |
|---|---|---|---|---|
| M01 Self-managed | object → estimate → work → materials → money/docs → closeout | `PARTIAL` | `PARTIAL` | Нет one-SHA lifecycle через recovery/closeout. |
| M02 One contractor | invite → participant → work → acceptance → money/docs → warranty | `PARTIAL` | `PARTIAL` | Bounded slices не собраны в один lifecycle. |
| M03 Multi-contractor | principals → scoped work/finance/docs/chat → customer aggregate | `BLOCKED` | `BLOCKED` | #300/#344/#345. |
| M04 Contractor with team | principal authority → subordinate execution | `PARTIAL` | `PARTIAL` | Cross-domain commercial/execution authority не закрыта. |
| M05 Direct invite | invite → identity → scope → ordinary lifecycle | `PARTIAL` | `PARTIAL` | Invite/revoke/recovery не квалифицированы целиком. |
| M06 Marketplace | lead → quotes → choose → participant conversion → lifecycle | `BLOCKED` | `BLOCKED` | Participant/multi-contractor truth. |
| M07 Technical supervision | supervisor → inspect → issue → remediation → decision | `PARTIAL` | `PARTIAL` | Нет полного role-rights E2E. |
| M08 Viewer/guest | bounded share/read → revoke → stale-link denial | `PARTIAL` | `PARTIAL` | Revocation/file/session lifecycle. |
| M09 Portal-token | token → canonical action → replay/revoke/expiry | `PARTIAL` | `PARTIAL` | Нет полного token lifecycle. |
| M10 Closed/warranty | complete → archive/export → warranty → claim closure | `BLOCKED` | `BLOCKED` | #319 + closeout/warranty/history. |
| M11 Unstable network | offline/cache → intent → response-loss replay → reconcile | `BLOCKED` | `PARTIAL` | #316/#317 family-wide closure отсутствует. |
| M12 Account switch | A work → logout/B → no A publish/replay → A2 | `BLOCKED` | `BLOCKED` | #315 global generation isolation. |

---

## 4. Golden Path Board — GP1–GP8

| GP | Result | Main | Best candidate | Dominant blocker |
|---|---|---|---|---|
| GP1 | Project → Rooms → Estimate → Budget | `BLOCKED` | `PARTIAL` | #458 pending; #457/#448 bounded; create/recovery/browser shell. |
| GP2 | Marketplace → Quotes → Contractor | `BLOCKED` | `BLOCKED` | #300/#344/#345; #429 foundation only. |
| GP3 | Stages → Schedule → WorkOrder → Evidence → Progress | `BLOCKED` | `PARTIAL` | participant scope, #316, calendar/object authority, E2E. |
| GP4 | Acceptance → Rework → Portal → Warranty | `PARTIAL` | `PARTIAL` | closeout/warranty/portal/session не соединены. |
| GP5 | Invoice → Payment → Receipt → Expense → Refund | `BLOCKED` | `PARTIAL` | finance truth, replay/offline, provider boundary. |
| GP6 | Material → Approval → Purchase → Delivery → Receipt | `PARTIAL` | `PARTIAL` | broader purchase/delivery/return/finance family. |
| GP7 | Document → Version → Sign → Export/Archive | `BLOCKED` | `PARTIAL` | #473 fixes reference authority only; #320 native delivery, retention/provider truth remain. |
| GP8 | Chat → Inbox/Push → Read → Reminder | `PARTIAL` | `PARTIAL` | #315/#316/#317; #322 bounded only. |

**Promotion rule:** GP = `PROVEN` только после API + mobile-web на одном exact integrated SHA с canonical PostgreSQL + Redis + MinIO + API + Worker и применимыми error/retry/reversal/session сценариями.

---

## 5. Mutation Board — exact 26 mutating mobile surfaces

Источник inventory: #431 / PR #432. Это **25 business modules + `client.ts` transport/session owner**. Нельзя заменять этот executable inventory произвольными 26 объектами.

Для каждой поверхности финальная цепочка:

`intent → mutation → authoritative read → counterpart → linked recalculation/effect → validation/ACL → offline/timeout → commit+lost response → same-intent retry → changed-payload conflict → competing write → reversal/cancel → history → account/project switch`.

| ID | Surface | Main | Best candidate | Current boundary |
|---|---|---|---|---|
| F01 | `admin.ts` | `PARTIAL` | `PARTIAL` | Team/invite/subscription/operator не один lifecycle. |
| F02 | `auth.ts` | `BLOCKED` | `PARTIAL` | #428 logout revoke bounded; #315 open. |
| F03 | `calendar.ts` | `BLOCKED` | `PARTIAL` | #424 child binding bounded; #461 replay pending. |
| F04 | `chats.ts` | `BLOCKED` | `PARTIAL` | #322 strong bounded; family-wide #316/#317 open. |
| F05 | `design.ts` | `PARTIAL` | `CANDIDATE PROVEN` | #414 create replay bounded; full lifecycle open. |
| F06 | `documents.ts` | `BLOCKED` | `CANDIDATE PROVEN` | #473 exact `80111fd…` proves Stage/Payment project binding + pre-storage reject; GP7/#320 remain. |
| F07 | `estimate.ts` | `BLOCKED` | `PARTIAL` | #444/#448/#457 bounded; create/reversal/full estimate not integrated. |
| F08 | `floor.ts` | `BLOCKED` | `CANDIDATE PROVEN` | #441 exact `a322e1e…` now has required migrated-PostgreSQL proof; not integrated. |
| F09 | `issues.ts` | `BLOCKED` | `CANDIDATE PROVEN` | Existing #418 replay bounded; new #476 child-authority exact `3c178249…` is still PENDING at this cut. |
| F10 | `market.ts` | `BLOCKED` | `BLOCKED` | #300/#344/#345. |
| F11 | `materials.ts` | `BLOCKED` | `CANDIDATE PROVEN` | #460/#465 material-needs replay bounded; broader procurement open. |
| F12 | `misc.ts` | `PARTIAL` | `PARTIAL` | Viewer/portal/revoke/expiry not one lifecycle. |
| F13 | `notifications.ts` | `PARTIAL` | `PARTIAL` | #315 cross-account publication truth. |
| F14 | `os.ts` | `PARTIAL` | `PARTIAL` | Read/analytics depend finance/session/participant truth; replaced legacy expense route is not canonical. |
| F15 | `payments.ts` | `BLOCKED` | `PARTIAL` | Provider/expense/refund lifecycle not fully connected. |
| F16 | `projects.ts` | `BLOCKED` | `PARTIAL` | #434 bounded lifecycle; #319 purge; #300 scope. |
| F17 | `receipts.ts` | `BLOCKED` | `PARTIAL` | #317 + finance/material actual truth. |
| F18 | `rooms.ts` | `PARTIAL` | `PARTIAL` | #438/#440 bounded; connected authority/GP1 pending. |
| F19 | `scratchpad.ts` | `PARTIAL` | `PARTIAL` | Нет connected lifecycle evidence. |
| F20 | `selections.ts` | `PARTIAL` | `CANDIDATE PROVEN` | #416 create replay bounded; decisions/side effects family open. |
| F21 | `stages.ts` | `BLOCKED` | `PARTIAL` | #452 child ACL bounded; replay family not closed. |
| F22 | `technicalSupervision.ts` | `PARTIAL` | `PARTIAL` | assignment→finding→remediation→decision not closed. |
| F23 | `workAcceptances.ts` | `PARTIAL` | `PARTIAL` | Portal/warranty/offline/retry not one proof. |
| F24 | `workOrders.ts` | `BLOCKED` | `PARTIAL` | Direct replay evidence useful, integration incomplete. |
| F25 | `workSchedule.ts` | `BLOCKED` | `BLOCKED` | Replay policy/qualification incomplete. |
| F26 | `client.ts` | `BLOCKED` | `PARTIAL` | #315/#317 global blockers; bounded dedupe prerequisite only. |

---

## 6. Exact-candidate evidence ledger

### `CANDIDATE PROVEN` — bounded evidence only

| Candidate | Exact-head / evidence boundary | Что реально доказано | Что НЕ доказано |
|---|---|---|---|
| #425 | `9984e7bf…` | source/bootstrap + exact check recovery; rerun contaminated 8 core contexts SUCCESS | merge/reviewer topology; product lifecycle. |
| #437 | `63dd6b0…`; core `35208897863`; runtime `35208897864`; policy `35209424047` | required PR-context scheduling + prevention of stacked feature-push contamination | live reviewer/admin settings; must refresh after #425. |
| #389 | `a32c554…` on #425 lineage | PCRE2 backend-image remediation | npm/product behavior; stale after future #425 merge. |
| #372 | `6d6ef7e…` on #425 lineage | bounded npm lock remediation | review lineage/future dependency drift. |
| #450 | `ed8b602…` on #425 lineage | canonical registry-pull retry | external registry uptime. |
| #424 | `a21f76a…` | calendar stage child/project binding | iCal atomicity/replay. |
| #452 | `709c2d0…` | stage reaction child binding | full reaction family. |
| #444 | `bc52758…` | estimate-line PATCH path/object binding | create/reversal/full estimate. |
| #455 | `0859c47…` | project-media current project ACL | chat-media/thread ACL, purge/native. |
| #456 | `bbebaa9…` on #455 | chat attachment current thread ACL | storage retention/native export. |
| #441 | `a322e1e…`; core `35209195920`; policy `35209450881` | floor-plan/pin/furniture project binding + migrated PostgreSQL contract executed SUCCESS | integration on trusted main/full floor lifecycle. |
| #473 / #472 | `80111fd…`; core `35210301494`; backend `1093 passed / 18 skipped` | document Stage/Payment project binding; multipart rejects before file/storage; Playwright + PG migration green | GP7/native/retention/provider; integration. |
| #322 | `582fd727…`; qualified context `76d63052…` | chat invoice/task atomic command + safe replay | all #316, #315/#317, payment truth. |
| #414 | `54025fb…` | design create replay primitive | full design/approval/file lifecycle. |
| #416 | `ddf7c208…` | selection create replay primitive | decision/material side effects family. |
| #418/#459 | `4b93a0de…`; CI `35097643070` | issue-create atomic replay + PG authority/race + restart | issue transition/close/escalate and new child-binding #476. |
| #460/#465 | `83199215…`; CI `35099288980`; PG `35099289096` | material-needs atomic replay + PG authority/race + restart | procurement lifecycle. |
| #448 | `2df6e660…` | Change Order approve/reject/replay/conflict + linked effects | GP1/full finance. |
| #457 | `c8120c17…`; candidate schema `w23estimatelifecycle01` | reversible estimate-line remove/restore | canonical main remains w22; GP1 not promoted. |
| #382 | `953a821…` | sum-preserving period allocation + unavailable fact semantics | full finance ledger/provider lifecycle. |
| #426 | bounded candidate | simulated fiscal/NPD ports | real providers/GP5/GP6. |
| #367 deployed | `0d58416…`, run `35084701908` | role/project entry + mutation proof | full browser UX; Chromium/WebKit red. |

### `PARTIAL` / pending / blocked despite useful work

- #476 / #474 issue child-reference binding — production-fix head `3c178249…`; exact core CI `35210881697` still completing at this cut, so **not promoted early**.
- #383 WorkOrder replay — useful PG evidence; integrated comparable qualification absent.
- #385 chat reaction replay — useful stacked evidence; family/integration remain.
- #387 intent-aware queue dedupe — prerequisite, not global #316/#317 closure.
- #392 chat-thread replay — remains PARTIAL.
- #404 stage-comment replay — bounded evidence, refreshed integration needed.
- #412 estimate-line create replay — bounded evidence, prerequisite integration pending.
- #461 iCalendar atomic/replay — exact qualification pending.
- #458 integrated GP1 — Chain verified remains pending.
- #408 materials post-commit UX — source repair exists; exact qualification required before promotion.
- #391/#393/#395/#397/#403/#405/#407/#410/#411 — UX/accessibility/navigation candidates, not completion claims.
- #429 participant API client — foundation only.
- #428 logout revoke — one session slice only.

### Sibling security scan disposition

- Documents Stage/Payment reference defect confirmed → #472/#473, bounded candidate proven.
- Issues Room/Stage/FloorPlan reference defect confirmed → #474/#476, qualification pending at this evidence cut.
- MaterialPick create: checked and already project-binds Room/analog references; no duplicate P0 created.
- Purchases: project-scope MaterialPick lookup confirmed; no independent defect created from source scan.
- Receipts: canonical integrity service already resolves Payment/Stage/Room against project.
- Payments: Stage resolution already project-scoped.
- Expense suspicion #477: **closed `not_planned` as false positive** after canonical router verification. `router.py` removes legacy OS PATCH/DELETE and installs `expense_mutations.router`; `expense_integrity_service` already validates Room/Stage project ownership and explicit-null semantics. This is evidence that raw legacy code presence is not enough to declare a runtime defect.

---

## 7. Integration DAG — текущий порядок

### Wave 0 — trustworthy integration foundation

1. Resolve live independent-review prerequisite under #247; do not self-approve or weaken checks.
2. Owner review/merge **#425** once ruleset requirements are genuinely satisfiable.
3. Rebase/requalify on resulting `main`: **#389**, **#372**, **#437**, **#450**.
4. Verify live protection with positive + negative enforcement evidence; source CI does not replace admin evidence.
5. After every prerequisite merge, recalculate descendant bases/heads and rerun affected exact-SHA evidence.

**Current Wave-0 truth:** source/check-lineage work is technically qualified; #425 is blocked by external owner-side reviewer topology. While that administrative prerequisite is unavailable, continue independent Wave-1 P0 authority work rather than idle or bypass the gate.

### Wave 1 — security/data authority

6. Rebase/requalify **#444**, **#424**, **#452**, **#441** on trusted main; #441 now has mandatory PostgreSQL proof.
7. Rebase/requalify **#455 → #456**.
8. Rebase/requalify **#473/#472 Documents authority**.
9. Finish exact qualification **#476/#474 Issues authority**, then refresh on trusted main.
10. Continue sibling/cross-project scan only against canonical registered runtime paths; confirmed P0 enters Wave 1, false positives are closed with evidence.
11. Rebase/requalify finance truth **#381/#382** and producers; explicit zero ≠ missing.

### Wave 2 — replay/atomicity

12. Refresh/review/integrate **#322** first as recovery-tree prerequisite.
13. Rebase exact children; raw stacked test counts are not integration.
14. Early cross-cutting recovery: **#387**, then mutation-specific slices.
15. Integrate only after exact qualification: #385, #383, #392, #404, #412, #414, #416, #418, #460; then #461.
16. Repeat executable #431 inventory and close **#316 only when no reachable mutation remains unsafe**.

### Wave 3 — global session/offline/cache

17. Close **#315**: generation fence across request/token/storage/navigation/cache/inbox/queue/files; A→B→A and project1→project2.
18. Close **#317**: transport taxonomy, durable enqueue reachability, per-resource cache provenance/as-of.
19. Airplane/restart/reconnect + delayed-response + account-switch matrix across queued families.

### Wave 4 — financial truth + first connected GP1

20. Requalify project/room lifecycle #434/#438/#440.
21. Integrate estimate lifecycle #444/#412/#457 + Change Order #448 + budget truth #381/#382 on one lineage.
22. Reconcile plan/revised/obligation/actual/payment/receipt/refund/unknown facts and drill-down.
23. Rebuild **#458** and prove GP1 API + mobile-web on one SHA including second-side/retry/reversal.

### Wave 5 — participants / GP2 / GP3

24. Close **#300/#344/#345** across work/schedule/workorders/chat/notifications/docs/materials/expenses/payee.
25. Complete participant UX after #429; API-only foundation is not product-complete.
26. Two/three-contractor sibling negatives + customer aggregate truth.
27. Connect GP2 and GP3 API + mobile-web.

### Wave 6 — lifecycle closure edges

28. **#319** purge/retention/storage full graph.
29. **#320** authenticated native file save/share after #315.
30. Unified closeout → archive/history → warranty → warranty closure.
31. Close M07 supervisor, M08 viewer/revoke, M09 portal-token lifecycle.
32. Internal simulated-provider qualification only; no automatic real-provider activation.

### Wave 7 — Human Usability Closure

33. Customer Home: `статус → нужно решить → 7 дней → план/факт/прогноз → главный риск`.
34. Contractor Home: `сегодня → просрочено → заблокировано → ждёт заказчика → готово к сдаче → деньги`.
35. Stable top-level navigation; no phase-driven learned-position breakage.
36. Object: `Комнаты / Смета / Чертежи и дизайн / Данные объекта`.
37. Estimate: `Сводка / Позиции / Изменения / Документы`; Change Order = `Дополнительные работы`.
38. Stage = aggregate container: tasks/materials/time/money/photos/issues/next action.
39. Materials: `Нужно → Согласовано → Заказано → Доставлено`; **approved ≠ ordered**.
40. Schedule: `Сегодня / 2 недели / Весь ремонт`; delays expose causes.
41. Inbox = one attention center; Approvals = detail; Chat = context, not second source of truth.
42. Unified acceptance/issue/warranty cards with explicit role actions.
43. Documents: `Проект / Финансы / Приёмка и гарантия / Архив`; technical exports = advanced integrations.
44. Contextual quick actions, accessibility/navigation, role-by-role friction retirement.

### Wave 8 — one immutable PRODUCT COMPLETE candidate

45. GP1–GP8 API + mobile-web on canonical PostgreSQL + Redis + MinIO + API + Worker.
46. Customer×contractor concurrent run.
47. Slow network/offline/response-loss/conflict/reversal/account-switch run.
48. Chromium + WebKit 100% green; required native iOS/Android paths green.
49. Deterministic review seed: active + near-closeout objects.
50. Freeze exact SHA; any source change creates a new candidate and affected requalification.
51. Release Evidence Pack = Board + GP + mutation inventory + calculations + security + migrations/restore + browser/device + provider truth + known external limitations.

### Wave 9 — external production qualification

52. Persistent staging / exact-artifact promotion.
53. Managed backup/PITR restore drill; measured RPO/RTO.
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
3. Внутри Wave выбрать минимальный bounded контур, который закрывает lifecycle/data-authority cell, а не добавляет экран.
4. Если prerequisite требует owner/admin action — не обходить; брать независимую задачу того же/более высокого риска.
5. После exact CI обновить candidate status.
6. После merge обновить main status и заставить descendants rebase/requalify.
7. Если новая находка опровергается canonical route/service evidence — закрыть её, а не защищать ошибочно созданный backlog.
8. Если новая находка делает прежний план неверным — изменить план, а не защищать старую очередь.

**На текущем evidence cut integration-critical шаг остаётся owner-side resolution #247 → merge #425.** Поскольку этот prerequisite сейчас административно заблокирован, активная техническая работа продолжается в Wave 1: завершить #476 и sibling authority scan, не переходя к более низким UX-приоритетам. После #425 — fresh rebase/requalification #389/#372/#437/#450, затем всех Wave-1 candidates.

---

## 9. Что не считается прогрессом

Не повышают readiness сами по себе:

- новый экран/кнопка/endpoint;
- скрытие failing assertion или подгон expected value;
- success одного браузера вместо required matrix;
- SQLite вместо требуемого PostgreSQL proof;
- source existence вместо user result;
- candidate на stale base;
- simulated provider, названный production;
- cache, выданный за fresh;
- отсутствие ошибки, выданное за commit;
- `0` вместо unknown;
- foundation merge, выданный за parent cross-domain closure;
- подозрительный legacy source, если canonical router его уже заменяет.

---

## 10. Final PRODUCT COMPLETE gate

Claim разрешён только когда одновременно на одном exact integrated SHA:

1. Нет открытых launch-blocking P0 product/security/data defects.
2. GP1–GP8 = `PROVEN` API + mobile-web.
3. M01–M12 имеют tested disposition; M03/M11/M12 не waived.
4. Critical mutation surfaces имеют normal/error/retry/reversal/session evidence.
5. Same-intent response-loss не дублирует business fact; changed intent конфликтует там, где требуется.
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

После этого оставшееся `FUTURE EXTERNAL` — deployment/provider qualification, а не незакрытый внутренний продукт RENOVA.
