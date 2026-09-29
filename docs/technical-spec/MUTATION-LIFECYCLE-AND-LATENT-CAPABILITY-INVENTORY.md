# Mutation lifecycle + latent capability inventory

Status: `SOURCE INVENTORIED`  
Audit date: 2026-09-14  
Audited `main`: `e5c6ee44c0f684b14037e77948dbcb630fd41896`  
Tracking: #431  
Parent product contract: `PRODUCT-COMPLETION-MANDATE.md`, `GOLDEN-PATHS.md`, `AGENTS.md`.

## 1. Purpose and evidence boundary

This annex converts the current product-completion pass into an explicit mutation contract. A screen is not considered complete because its controls render or because an HTTP request can be emitted. For every durable business mutation the acceptance sequence is:

`create → authoritative read-after-create → update/transition → re-read linked/derived facts → cancel/delete → restore/reconcile`.

The sequence must be exercised separately under **customer** and **contractor** authority. A role may legitimately receive `403/404`; that is a valid result only when the denial is part of the intended authority model and leaves no partial state.

This first bounded slice is source inventory and contract enforcement. It **does not claim runtime E2E verification**. A family becomes `E2E VERIFIED` only when the canonical PostgreSQL/Redis/MinIO/API/Worker stack proves the positive path, negative role path, retry/response-loss path where applicable, second-side visibility, linked calculations, and recovery semantics.

### Lifecycle cell vocabulary

- `PENDING E2E` — capability is present in source, but the complete lifecycle has not yet been proven by current evidence.
- `BLOCKED #NNN` — a known defect prevents honest lifecycle qualification.
- `N/A` — the phase is not meaningful for that mutation family; the required terminal/reconciliation behavior is named in the row instead.
- `SOURCE` — source/call-site evidence exists, but this is not runtime proof.

Customer (`C`) and contractor (`K`) columns below intentionally remain conservative: `PENDING E2E` means backend authority is not declared proven merely from UI audience or route visibility.

## 2. API mutation-module coverage

The mobile API barrel currently exports the following domain modules. They are all classified here so a newly mutating module cannot appear silently. The contract test scans `apps/mobile/lib/api/*.ts` for static `POST`, `PATCH`, `PUT`, or `DELETE` writers and fails when a mutating module is not classified.

| Module | Product responsibility | Mutation audit scope |
|---|---|---|
| `admin.ts` | team/subscription/tax-link/checklists plus operator recovery/admin APIs | user flows and operator-only flows must be separated |
| `auth.ts` | authentication/session mutations | login/session/recovery, not business-object lifecycle |
| `calendar.ts` | calendar/stage-date/iCalendar actions | schedule date mutation + import recovery |
| `chats.ts` | threads/messages/reactions/tasks/invoices | create/edit/transition/replay identity |
| `design.ts` | design package/approval flow | create/submit/decision/recovery |
| `documents.ts` | documents/e-sign/export-related mutations | version/sign/status/delete where supported |
| `estimate.ts` | estimates/lines/change orders | line lifecycle, lock/decision, linked totals |
| `floor.ts` | floor plans/pins/furniture | project binding + object graph lifecycle |
| `issues.ts` | punch/quality issues | create/transition/fix/reopen/recovery |
| `market.ts` | marketplace lead/quote/contractor choice | lead → quote → selection/reconciliation |
| `materials.ts` | picks/needs/purchases/supply/prices | selection→purchase→supply→fact/recovery |
| `misc.ts` | viewers/portal/approvals/general queued creates | access, portal decisions, approval decisions |
| `notifications.ts` | notification state/actions | read/action state without inventing a second attention hub |
| `os.ts` | Renova OS/profile/workspace actions | durable settings/workspace mutations |
| `payments.ts` | payments/evidence/disputes/refunds | financial state machine + evidence/reversal |
| `projects.ts` | project create/edit/archive/trash/restore/purge/assignment | complete project lifecycle and derived dashboards |
| `receipts.ts` | receipts/expenses/fact helpers | create/edit/delete/reverify + financial reconciliation |
| `rooms.ts` | rooms | create/edit/delete + estimate/floor dependencies |
| `scratchpad.ts` | project scratchpad | create/edit/delete/promote where supported |
| `selections.ts` | finish/material selections | create/decision/recovery |
| `stages.ts` | stages/status/comments | create/edit/transition/comments + progress facts |
| `technicalSupervision.ts` | technical supervision assignments/quality | assignment/decision/issue integration |
| `workAcceptances.ts` | work acceptance/return | request→accept/return→rework→accept |
| `workOrders.ts` | work orders | create/edit/transition + schedule/progress links |
| `workSchedule.ts` | work schedule and items | create/submit/decision/item status/recovery |

Support files such as `client.ts`, `failurePolicy.ts`, `types.ts` and the barrel `index.ts` are infrastructure, not domain mutation families.

## 3. End-to-end mutation lifecycle matrix

The table is the work queue. `PENDING E2E` is deliberately not green.

| Family | C authority | K authority | Create + read-after-create | Update / transition | Linked facts that must be re-read | Cancel/delete | Restore/reconcile | Current blocker/evidence | Next executable proof |
|---|---|---|---|---|---|---|---|---|---|
| Project create/edit | PENDING E2E | PENDING E2E | PENDING E2E | PENDING E2E | dashboard, phase, project picker, role visibility | see project lifecycle | see project lifecycle | assignment/multi-contractor truth: #300, #344 | GP1 role-separated API + mobile-web path |
| Project archive/trash/purge | PENDING E2E | PENDING E2E | N/A | archive/unarchive/trash | project buckets, active-project selection, related counters | purge/empty trash | unarchive/restore; permanent purge graph | `projects.ts` SOURCE; purge blocker #319 | create project → archive → unarchive → trash → restore → purge, then stale-link negative tests |
| Rooms | PENDING E2E | PENDING E2E | PENDING E2E | PENDING E2E | estimate allocations, floor/object views | PENDING E2E | recreate/reconcile references | no runtime qualification recorded here | GP1 room lifecycle for both roles + foreign-project negatives |
| Floor plan / pins / furniture | PENDING E2E | PENDING E2E | PENDING E2E | PENDING E2E | room/object plan state | PENDING E2E | reconcile project ownership | BLOCKED #377 | cross-project create/update/delete negatives + GP1 |
| Estimate / estimate lines | PENDING E2E | PENDING E2E | BLOCKED #406 | PENDING E2E | planned total, room/category totals, budget, material needs | PENDING E2E | replay-safe create; lock reconciliation | BLOCKED #375, #406 | create line with stable intent id → read totals → edit → delete → retry same intent |
| Change orders / estimate decisions | PENDING E2E | PENDING E2E | PENDING E2E | approve/reject/lock | estimate revision, budget delta, approval hub, notifications | reject/cancel according to state machine | decision idempotency + second-side state | SOURCE; full E2E not qualified here | contractor proposes → customer decides → both sides re-read budget/revision |
| Budget truth / derived finance | PENDING E2E | PENDING E2E | N/A | driven by upstream mutations | budget planned/spent, allocation, room/category breakdown, forecast | N/A | recompute from canonical ledger | BLOCKED #318, #379 | mutate upstream estimate/payment/expense/receipt and assert every producer agrees |
| Stages | PENDING E2E | PENDING E2E | PENDING E2E | status/progress/date transition | project progress, calendar, payments/acceptance eligibility | PENDING E2E where supported | reconcile status/progress | date-scope blocker #421 | GP3 + foreign-project stage mutation negatives |
| Calendar / iCalendar | PENDING E2E | PENDING E2E | import/create SOURCE | date/status edits | stage dates, calendar events, work schedule | remove/import replacement as supported | atomic import/replay | BLOCKED #421, #422 | import → re-read → edit → repeat response-loss import → verify no partial/duplicate state |
| Work schedule | PENDING E2E | PENDING E2E | BLOCKED #420 | item/status/submit decisions | calendar, stage readiness, attention state | reject/cancel per state machine | response-loss replay | BLOCKED #420, #316 | create+submit intent replay + customer confirmation/rejection + second-side re-read |
| Work orders | PENDING E2E | PENDING E2E | PENDING E2E | optimistic PATCH + state transitions | stage/progress/schedule/attention | cancel where state machine allows | retry/reconcile expected version | generic replay risk #316 | GP3 create → edit → transition → conflict/retry → terminal state |
| Acceptance / rework | PENDING E2E | PENDING E2E | request SOURCE | accept/return/rework | stage status, project progress, warranty/completion eligibility | return is business reversal | repeated decision must reconcile | GP4 contract exists; runtime qualification pending | contractor requests → customer returns → contractor fixes → customer accepts |
| Issues / punch / quality | PENDING E2E | PENDING E2E | BLOCKED #417 | fix/reopen/close | QC counters, acceptance readiness, notifications | terminal close/cancel as model allows | replay create + reopen | BLOCKED #417 | offline/response-loss create → read → fix → reopen/close, both roles |
| Warranty | PENDING E2E | PENDING E2E | PENDING E2E | claim/decision/status | document center, QC, completion state | close/cancel per state machine | reopen/reconcile | route is contextual; E2E not qualified here | post-acceptance claim → contractor response → close/reopen negative path |
| Material selections | PENDING E2E | PENDING E2E | BLOCKED #415 | submit/approve/reject | approval hub, purchase readiness, budget | reject/cancel | replay-safe selection identity | BLOCKED #415 | create offline/response-loss → decision → both sides re-read selection and budget |
| Material needs / picks | PENDING E2E | PENDING E2E | generation BLOCKED #419 | pick/submit/approve/reject | estimate linkage, purchase readiness, material totals | reject/remove where supported | replay generation without duplicate needs | BLOCKED #419 | estimate mutation → generate needs twice under response loss → one canonical set |
| Purchases / supply / prices | PENDING E2E | PENDING E2E | PENDING E2E | purchase status, supply PATCH, price set/sync | material fact, expenses/budget, delivery status | cancel per purchase state | re-read price truth and supply truth | finance zero/truth interaction #379; generic #316 where queued | GP6 complete chain including retry and cancellation |
| Receipts / expenses | PENDING E2E | PENDING E2E | SOURCE, recovery path needs #317 | receipt PATCH/reverify | expense ledger, budget spent, room/stage totals | receipt DELETE | financial fact refresh/reconciliation | BLOCKED #317; aggregate truth #318 | create/scan → read → edit → verify ledger → delete → verify reversal; transport loss path |
| Payments / evidence | PENDING E2E | PENDING E2E | PENDING E2E | confirm/evidence/decision | payment history, budget/expenses, pending counters, documents where linked | reversal/refund, not destructive delete | webhook/idempotency/reconciliation | GP5 contract; global finance truth #318 | invoice → payment/evidence → read facts → dispute/refund → assert reversal everywhere |
| Disputes / refunds | PENDING E2E | PENDING E2E | PENDING E2E | dispute resolution/refund | payment history, Expense, budget spent | refund is reversal | duplicate webhook/response loss | GP5 contract | partial refund + repeated event + both-role history |
| Documents / e-sign | PENDING E2E | PENDING E2E | PENDING E2E | version/sign/status | contract gate, approval/completion state | delete/void where model permits | provider callback reconciliation | native delivery blocker #320 | GP7 create/version/sign/callback/export + revoked/stale-link negatives |
| Chat threads/messages | PENDING E2E | PENDING E2E | BLOCKED #390 for thread intent | message/task/invoice transitions | unread/inbox/attention, linked task/payment state | delete/cancel only if model supports | response-loss replay | BLOCKED #390, #386, #316 | GP8 repeated intent + second-side visibility + unread reconciliation |
| Chat reactions | PENDING E2E | PENDING E2E | reaction add/toggle SOURCE | toggle | reaction counts/state | toggle/remove | repeated request must converge, not invert | BLOCKED #384 | same-intent replay test proving stable final state |
| Chat tasks / invoices | PENDING E2E | PENDING E2E | PENDING E2E | task/invoice status | inbox, payment/attention state | cancel/close | queued duplicate intent | generic queue blocker #386/#316 where applicable | GP8 task + GP5 invoice cross-domain lifecycle |
| Viewers / portal links | PENDING E2E | PENDING E2E | SOURCE | link/unlink/share | viewer list, read-only access | remove viewer/revoke access | stale/revoked token behavior | customer portal call-sites exist; E2E still required | create viewer → open portal → revoke → prove old access fails |
| Portal decisions | customer magic-link | contractor N/A for guest decision | N/A | stage/schedule/estimate/change-order decisions | canonical project/approval/budget state | reject/return is business reversal | repeated decision reconciliation | SOURCE: portal actions are wired | GP4/GP7 portal decision with duplicate request and revoked token |
| Participants / multi-contractor | PENDING E2E | PENDING E2E | PENDING E2E | role/scope membership | finance/docs/chat/materials/payee/work orders visibility | remove/revoke | scope re-evaluation | BLOCKED #300, #344 | two independent contractors, overlapping project, strict scoped reads/writes |
| Marketplace | customer PENDING E2E | contractor PENDING E2E | lead/quote SOURCE | quote/choose/assign | project participant/contractor, inbox | withdraw/reject where supported | retry assignment/quote | GP2 contract | full GP2 customer+contractor API/mobile-web path |
| Design packages | PENDING E2E | PENDING E2E | BLOCKED #413 | submit/approve/reject | approvals, object/design state | reject/version | response-loss replay | BLOCKED #413 | create under response loss → submit → customer decision → version/re-read |
| Technical supervision | PENDING E2E | PENDING E2E | PENDING E2E | assignment/status/quality mutation | issues/QC/acceptance | deactivate/close as model allows | reassignment/reconcile | no runtime qualification recorded here | assignment → quality issue → acceptance interaction for both roles |
| Scratchpad | PENDING E2E | PENDING E2E | PENDING E2E | edit/promote where supported | promoted target entity and scratchpad state | delete | retry/promote reconciliation | generic offline policy applies if queued | contextual FAB path + negative project-scope test |
| Notifications / inbox actions | PENDING E2E | PENDING E2E | usually event-derived | read/action/dismiss | unread counters, destination state | dismiss/read | re-fetch canonical attention state | notifications route intentionally redirects to inbox | GP8 event → inbox → action → read counter reconciliation |
| Approval hub decisions | customer PENDING E2E | contractor PENDING E2E | event-derived | approve/reject | source entity status, inbox, budget/design/material facts | reject is business reversal | duplicate decision/re-fetch | generic offline queue semantics #386/#316 where applicable | each approval type: decision → source re-read → second-side notification |
| Team/subscription/tax links | role-specific PENDING E2E | role-specific PENDING E2E | SOURCE | role/link/subscription transitions | team/access/subscription/tax badges | unlink/remove where supported | provider/session reconciliation | mixed user and operator API in `admin.ts` | separate user-facing flows from operator-only controls before claiming lifecycle completeness |

## 4. Latent / non-menu capability inventory

A capability is not automatically a missing menu item. Navigation source of truth intentionally distinguishes `dock`, `more`, `hidden`, and `deeplink`; redirect aliases are deliberately not additional product hubs.

Classification:

- `EXPOSE_NOW` — canonical truth and lifecycle are already qualified; safe to make discoverable.
- `EXPOSE_AFTER_FIX` — useful capability exists, but current security/data/recovery truth blocks exposure.
- `DEEPLINK_BY_DESIGN` — contextual feature; should stay reachable from its owning workflow rather than become another menu center.
- `REDIRECT_BY_DESIGN` — compatibility/thin alias to a canonical hub; do not duplicate UI.
- `OPERATOR_INTERNAL` — admin/dev/recovery capability; never ordinary customer/contractor navigation.
- `LEGACY_RETIRE` — obsolete duplicate writer/surface that should not be promoted.

### 4.1 Registered routes not present as ordinary primary navigation

| Route/capability | Classification | What it is for | Product decision |
|---|---|---|---|
| `calendar` / Сроки | `DEEPLINK_BY_DESIGN` | schedule/calendar hub entered from Home schedule, optional dock, header More | keep canonical secondary entry points; do not create a sixth mandatory dock pillar |
| `finance-center` | `REDIRECT_BY_DESIGN` | old entry into payments | keep redirect to `Budget → payments` + payment sheet |
| `control` | `REDIRECT_BY_DESIGN` | old control/acceptance tab | keep redirect to `Repair → control` |
| `quality-control` | `DEEPLINK_BY_DESIGN` | contractor QC workflow | keep under `Repair → acceptance/control`, not More |
| `work-acceptance` | `REDIRECT_BY_DESIGN` | customer acceptance entry | keep contextual entry and redirect to canonical Repair control hub |
| `work-schedule` | `REDIRECT_BY_DESIGN` | old dedicated work-schedule surface | keep redirect to Calendar/Schedule hub |
| `notifications` | `REDIRECT_BY_DESIGN` | legacy notification page | keep single attention channel in `Inbox` |
| `scan-receipt` | `DEEPLINK_BY_DESIGN` | camera/manual receipt capture | open from Budget/Repair expense context |
| `stage` | `DEEPLINK_BY_DESIGN` | stage detail | open only from Repair/Schedule/Calendar entity context |
| `materials-procurement` | `REDIRECT_BY_DESIGN` | material purchasing hub | canonical location is `Repair → materials → purchases` |
| `selections` | `REDIRECT_BY_DESIGN` | finish/material selection hub | canonical location is `Repair → selections` |
| `warranty-claim` | `DEEPLINK_BY_DESIGN` | post-completion warranty claim | keep in Document Center/completion flow; do not add global hub |
| `design` | `REDIRECT_BY_DESIGN` | legacy design page | canonical location is `Object → plan → design`; legacy route must not regain independent writers |
| `conflicts` | `DEEPLINK_BY_DESIGN` | offline/sync conflict resolution | surface only when a conflict exists |
| `portfolio` | `DEEPLINK_BY_DESIGN` | contractor project portfolio/picker | contextual contractor project selection, not customer navigation |
| `scratchpad` | `DEEPLINK_BY_DESIGN` | quick project notes/drafts | contextual project FAB; keep out of main IA |
| `budget-planner` | `DEEPLINK_BY_DESIGN` | budget what-if/planning detail | enter from budget summary; not another finance hub |
| `checklist-templates` | `DEEPLINK_BY_DESIGN` | contractor reusable QA/work checklists | enter from work profile/control settings |
| `guide` | `DEEPLINK_BY_DESIGN` | help/reference | enter from profile help |
| `portal` | `DEEPLINK_BY_DESIGN` | customer guest magic-link snapshot and decisions | external/contextual link by definition; never main menu |
| `project-analytics` | `REDIRECT_BY_DESIGN` | legacy analytics route | canonical location is `Budget → deviations`; do not revive duplicate analytics screen |

### 4.2 Source capabilities with no verified ordinary UI consumer

| Capability | Classification | Source evidence | What it could provide | Why it is not exposed now |
|---|---|---|---|---|
| `projectsApi.getContractorAnalytics()` | `EXPOSE_AFTER_FIX` | mobile API exists; no call-site found in default-branch code search; backend `/projects/analytics/contractor-summary` queries `Project.contractor_id` | contractor portfolio summary with estimated margin and progress | conflicts with participant/scope multi-contractor direction (#300/#344); must migrate truth model before UI |
| `projectsApi.getAnalytics()` | `EXPOSE_AFTER_FIX` | mobile API exists; no call-site found in default-branch code search; backend `/projects/{id}/analytics` exists | compact project budget/material/progress/delay snapshot | backend material fact currently uses `quantity_actual or quantity_planned`, so explicit zero is wrong (#379); broader finance truth also under #318 |

These two APIs are the high-confidence code-only findings in this bounded pass. Absence of a code-search call-site is not sufficient by itself to delete them; both require either migration + explicit product placement or a separate retirement decision.

### 4.3 Operator surfaces that exist but must not become ordinary product navigation

| Capability | Classification | Purpose |
|---|---|---|
| Outbox dead-letter index/claim/release/replay/history and `/outbox-dead-letters` UI | `OPERATOR_INTERNAL` | controlled recovery of poisoned/outbox events with claim ownership and replay audit |
| Release/H0/e-sign/FNS/YooKassa health endpoints | `OPERATOR_INTERNAL` | readiness/diagnostic truth for operators and release verification |
| Revenue/projects/admin statistics and audit log APIs | `OPERATOR_INTERNAL` | operational/admin diagnostics, not customer or contractor project work |
| Article-admin CRUD | `OPERATOR_INTERNAL` | content administration |

The outbox recovery UI is intentionally a protected operational tool even though a mobile-web route exists. Its existence is not evidence that it belongs in customer/contractor navigation.

## 5. Explicit non-findings: features that looked hidden but are already wired

Do not duplicate these as “missing UI”:

- customer portal magic-link creation is used by portal/document sharing components;
- portal estimate/stage/schedule/change-order decisions are wired in the portal flow;
- project templates are used by the project empty state;
- receipt re-verification is used by `ReceiptList`;
- material price synchronization is used by material detail/list UI;
- budget forecast/scenario components have UI consumers;
- contract gate is consumed by Inbox and stage detail.

## 6. Execution order after this inventory

1. **P0 security/data truth** — #375/#377/#421, then #318/#379.
2. **P0 replay/recovery** — #316 plus #384/#386/#390/#398/#406/#413/#415/#417/#419/#420/#422.
3. **P0 session/offline classification** — #315/#317.
4. **Mutation lifecycle proof** — execute every row above as customer and contractor on canonical runtime; record create/read/update/derived/cancel-or-delete/restore-or-reconcile evidence.
5. **GP1–GP8** — only after the mutation primitives they rely on are green.
6. **Multi-contractor scope** — #300/#344 before exposing contractor-wide analytics.
7. **Lifecycle/files/UX** — #319/#320 and role-by-role friction states.

## 7. Promotion rule

No row may be described as “works end-to-end” until all applicable lifecycle columns are green under both intended roles and the following are re-read after the mutation:

- canonical entity state;
- every linked aggregate/KPI/counter;
- second-side/customer-or-contractor view where the mutation is collaborative;
- audit/outbox/notification state where applicable;
- offline/retry/reconciliation outcome for replayable mutations.

A passing button click is not acceptance evidence.