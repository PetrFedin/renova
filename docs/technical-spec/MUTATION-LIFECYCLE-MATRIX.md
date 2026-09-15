# RENOVA — Mutation Lifecycle Matrix

Статус этого документа — **release gate**. Он не заменяет тесты и не повышает readiness сам по себе.

Полностью рабочей изменяемая сущность считается только когда отдельно по разрешённым ролям доказан путь:

`create → read/list → update/transition → dependent aggregate/read-model → delete/cancel → recovery/reopen/replay`

и одновременно доказаны negative cases:

- wrong role / wrong project;
- cross-project identifier substitution;
- replay after lost response;
- same request identity + different payload;
- stale/session-changed request;
- archived/trashed/revoked access where applicable;
- locked/terminal state refusal;
- mobile-web entry point and deployed environment.

Обозначения: `GREEN` — код + regression proof; `PARTIAL` — существенная часть доказана, но lifecycle неполный; `GAP` — отсутствует обязательный контракт; `PENDING-DEPLOYED` — локальный/CI контракт есть, но текущий Render/deployed proof не подтверждён.

| Entity / command | Create | Read | Update / state | Recalc / dependent truth | Cancel / delete | Recovery / replay | ACL / cross-project | Mobile transport | Deployed proof | Current gate |
|---|---|---|---|---|---|---|---|---|---|---|
| Project lifecycle | GREEN | GREEN | GREEN | PARTIAL | GREEN trash/purge | GREEN restore | PARTIAL | GREEN | PENDING-DEPLOYED | PARTIAL |
| EstimateLine draft | GREEN | GREEN | GREEN | GREEN `budget_planned` | GREEN draft delete | GREEN create replay | GREEN project-scoped line id | PARTIAL | PENDING-DEPLOYED | PARTIAL |
| Estimate lock proposal | n/a | GREEN | GREEN propose/reject/withdraw/lock | GREEN | n/a | GREEN state replay semantics | GREEN roles | PARTIAL | PENDING-DEPLOYED | PARTIAL |
| Receipt manual/scan | GREEN | GREEN | GREEN source update | GREEN canonical Expense + `budget_spent` | GREEN source delete | GREEN stable request ledger | GREEN | GREEN ambiguous-failure queue | PENDING-DEPLOYED | PARTIAL |
| Source-backed Expense | derived | GREEN | GREEN source-only | GREEN | source-only | n/a | GREEN | PARTIAL | PENDING-DEPLOYED | PARTIAL |
| ProjectIssue / QC | GREEN atomic | GREEN | GREEN role transition graph | GREEN pending/control read models | GREEN close | GREEN reopen + create replay | GREEN referenced room/stage/plan | GREEN create transport | PENDING-DEPLOYED | PARTIAL |
| QC / stage photo media | GREEN association | GREEN signed URL | n/a | n/a | PARTIAL | signed URL renew by reread | GREEN project privacy-404 | GREEN render contract | PENDING-DEPLOYED | PARTIAL |
| Stage create | GREEN | GREEN | GREEN selected mutations | GREEN schedule read model | **GAP safe entity cancel/delete** | GREEN create replay | GREEN | GREEN create identity | PENDING-DEPLOYED | GAP |
| WorkOrder create | GREEN atomic | GREEN | PARTIAL | PARTIAL | GAP lifecycle matrix incomplete | GREEN request replay | PARTIAL | GREEN create identity | PENDING-DEPLOYED | PARTIAL |
| Purchase create | GREEN | GREEN | GREEN status machine | GREEN material/dependency truth | GREEN cancel/return semantics | GREEN create + state replay semantics | PARTIAL | GREEN create identity | PENDING-DEPLOYED | PARTIAL |
| MaterialPick create | GREEN | GREEN | PARTIAL | GREEN supply/price truth | GAP full lifecycle | GREEN create identity | PARTIAL | GREEN create identity | PENDING-DEPLOYED | PARTIAL |
| Material needs from estimate batch | GREEN atomic | GREEN | derived | GREEN source projection | GAP projection removal/reconcile lifecycle | GREEN batch request identity + project lock | GREEN project | GREEN | PENDING-DEPLOYED | PARTIAL |
| SelectionItem | GREEN atomic | GREEN | GREEN propose/approve/reject | GREEN approved selection → material truth where applicable | GAP explicit draft removal lifecycle | GREEN create replay | GREEN room project scope | GREEN create identity | PENDING-DEPLOYED | PARTIAL |
| WorkAcceptance | derived/requested | GREEN | GREEN accept/return | GREEN stage/control truth | return/reopen semantics | GREEN state replay semantics | GREEN roles | PARTIAL | PENDING-DEPLOYED | PARTIAL |
| ChangeOrder | GREEN | GREEN | GREEN approve/reject | GREEN estimate/budget delta | reject semantics | PARTIAL | PARTIAL | PARTIAL | PENDING-DEPLOYED | PARTIAL |
| Warranty claim | GREEN atomic | GREEN | GREEN issue lifecycle | GREEN control/warranty truth | close/reopen semantics | GREEN request replay | PARTIAL | PARTIAL | PENDING-DEPLOYED | PARTIAL |
| Technical supervision appointment | PARTIAL | GREEN | PARTIAL | GREEN role/capability reads | PARTIAL revoke/replace | PARTIAL | GREEN role boundary | PARTIAL | PENDING-DEPLOYED | PARTIAL |
| ChatMessage | GREEN atomic | GREEN | pin/react/confirm state | unread/inbox/outbox | n/a | GREEN stable request replay | GREEN thread/project ACL | GREEN ambiguous-failure queue | PENDING-DEPLOYED | PARTIAL |
| Chat task command | GREEN atomic | GREEN | linked WorkOrder | GREEN link + outbox | follows WorkOrder | GREEN qualified request replay | GREEN project/thread authority | GREEN | PENDING-DEPLOYED | PARTIAL |
| Chat invoice command | GREEN atomic | GREEN | linked Payment | GREEN payment + outbox | follows Payment | GREEN qualified request replay | GREEN contractor authority | GREEN | PENDING-DEPLOYED | PARTIAL |
| ChatThread create | GREEN service test | GREEN legacy reads | archive/pin per-user state | unread/read models | archive state | GREEN endpoint test | GREEN project write | **GAP mobile create wiring** | PENDING-DEPLOYED | **GAP runtime route wiring** |
| WorkSchedule create | GREEN atomic | GREEN | GREEN submit/confirm/reject guards | GREEN schedule/notification effects | GAP archive/cancel entity lifecycle | GREEN create + review replay | GREEN manager/customer roles | GREEN create/review ambiguous retry | PENDING-DEPLOYED | PARTIAL |
| WorkScheduleItem status | n/a | GREEN | PARTIAL role-safe same-status | schedule progress | cancelled terminal | **fresh-only until exact replay qualified** | GREEN same-status authority fix | fresh-only intentionally | PENDING-DEPLOYED | PARTIAL |
| ProjectDocument / file | PARTIAL | GREEN | GREEN lifecycle subset | document/read models | PARTIAL archive/restore/delete | PARTIAL | PARTIAL | PARTIAL | PENDING-DEPLOYED | GAP until create/upload replay audited |
| RoomChangeRequest | PARTIAL | GREEN | PARTIAL approve/reject | room truth | reject semantics | GAP create replay audit | PARTIAL | PARTIAL | PENDING-DEPLOYED | GAP |
| WasteOrder | PARTIAL | GREEN | PARTIAL state | PARTIAL | cancel semantics | GAP create replay audit | PARTIAL | PARTIAL | PENDING-DEPLOYED | GAP |
| Account session | GREEN login | GREEN `/me` | GREEN refresh | identity/project state fenced | GREEN logout + revoke | GREEN generation fence | GREEN account boundary | GREEN A→B→A fence | PENDING-DEPLOYED | PARTIAL until CI/deployed confirmed |
| OfflineQueue job | GREEN enqueue | GREEN status | GREEN retry/conflict/block | n/a | GREEN remove/drop project | GREEN session-scoped replay | GREEN `userId + sessionId` | GREEN | PENDING-DEPLOYED | PARTIAL until gate confirmed |
| Durable GET cache | n/a | GREEN primitive | n/a | provenance `asOf/source/reason` | invalidate | GREEN stale fallback only in `cachedGet` | user-keyed + session request fence | GREEN banner registry | PENDING-DEPLOYED | PARTIAL until gate confirmed |

## Immediate order of closure

1. Finish `ChatThread` runtime route replacement + mobile stable create identity.
2. Qualify `WorkSchedule` targeted CI and deployed create/review flow.
3. Close remaining unsafe create producers in golden paths: `ProjectDocument`, `RoomChangeRequest`, `WasteOrder`, stage comment/photo create where queued.
4. Define a domain-safe Stage cancel/delete contract; do not use project purge as a substitute for entity lifecycle.
5. Complete WorkOrder / MaterialPick / Selection cancel-delete-recovery semantics.
6. Run customer + contractor API mutation matrix against deployed Render.
7. Run corresponding mobile-web UI mutation E2E.
8. Only after every required row is GREEN on deployed environment may RENOVA be labelled `полностью рабочий продукт`.
