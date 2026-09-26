# RENOVA — полная матрица режимов, ролей и сквозных сценариев продукта

**Статус:** ACTIVE / ACCEPTANCE ANNEX.
**Parent:** `PRODUCT-COMPLETION-MANDATE.md` + `USER-JOURNEY-CATALOG.md`.
**Назначение:** не новый roadmap, а обязательная coverage-матрица. Полноценность продукта нельзя доказать только GP1–GP8, если реальные комбинации ролей/состояний остаются тупиковыми.

---

# 1. Базовые режимы использования

| Mode | Участники | Что должно работать end-to-end | Недопустимый тупик |
|---|---|---|---|
| M01 Self-managed | customer без contractor | object→estimate→schedule/self-work→materials→expenses/docs→closeout | приложение требует `contractor_id` для обычного чтения/работы |
| M02 One contractor | customer + один independent contractor | lead/invite→scope→work→acceptance→money/docs/warranty | выбор contractor создаёт project, но дальнейшие права/экраны пусты |
| M03 Multi-contractor | customer + E1/E2/E3 | independent scopes + aggregate customer view + sibling isolation | один global contractor перетирает второго |
| M04 Contractor with team | independent contractor principal + employees/team | principal owns commercial scope, team members execute permitted work | team membership случайно делает сотрудника независимым payee/contract party |
| M05 Direct invite | customer приглашает известного contractor без marketplace | invite→identity/accept→participant→scope→project | marketplace обязателен для создания доступа |
| M06 Marketplace conversion | lead + quotes | compare→select→atomic conversion→project lifecycle | после выбора quote нужен ручной повторный setup |
| M07 Technical supervision | customer + contractor(s) + supervisor | inspection/evidence/issues without customer decision impersonation | supervisor получает право платить/принимать без explicit delegation |
| M08 Viewer/guest | owner + read-only invited person | limited read/share, revoke | viewer deeplink мутирует project |
| M09 Portal-token action | external limited acceptance/document flow | one resource, bounded action, replay-safe | token становится generic project session |
| M10 Closed/warranty | completed project + historical contractors | archive/read/export/warranty/reopen where allowed | удаление contractor стирает ответственность |
| M11 Unstable network | any role | offline/cache/queue/reconcile | second mutation after response loss |
| M12 Account switch | user A→B→A | complete actor/session isolation | queued A request executes with B token |

---

# 2. Customer lifecycle matrix

## 2.1. Account and first run

1. New phone → OTP request → code → session.
2. Wrong/expired code → explicit error; no half-created authority.
3. Rate-limit → retry guidance without fake login.
4. Existing user login → project discovery.
5. User has zero projects → real empty state with create/join actions; no fabricated demo project.
6. User has one project → deterministic load.
7. User has several projects → project picker before context-sensitive mutation.
8. Project load races another selection → stale result discarded.
9. Logout online → server revoke attempt + local authority clear.
10. Logout offline → local logout completes; server revoke remains unconfirmed, never reported as done.
11. Login as B → no A cache/queue/state disclosure.
12. Return A→B→A → new generation; old A1 completion not accepted by A2.

## 2.2. Object creation and setup

Customer can:
- create project;
- enter address/general parameters;
- add/edit/archive/restore rooms;
- set dimensions/types;
- use floor/plan/design foundations;
- calculate room/material quantities;
- create/edit draft estimate;
- freeze/approve baseline;
- create change request/order for approved-scope changes;
- attach design package/documents;
- continue without contractor.

Every action defines:
- draft vs approved truth;
- what recalculates automatically;
- what requires reapproval;
- version/provenance;
- replay/idempotency if mutation can retry.

## 2.3. Finding/inviting contractors

Customer routes:

### Marketplace
`lead draft → publish → contractor views → quote(s) → compare → select`.

### Direct invite
`phone/profile code/link → invite → accept/register/login → participant → scope`.

### Multiple contractor strategy
Customer may assign:
- electrician to electrical scope;
- plumber to plumbing;
- tiler to finishes;
- designer to design-related scope;
- general coordinator optionally, without automatic ownership of all sibling work.

Required UI:
- participant list;
- role/principal type;
- scope;
- status invited/active/removed;
- responsible work/stages;
- contract/payee attribution where relevant;
- replace/reassign/remove.

## 2.4. Planning

Customer sees:
- approved baseline schedule;
- proposed changes;
- dependencies;
- contractor attribution;
- material blockers;
- acceptance blockers;
- late items;
- delivery/payment milestones where relevant.

Schedule change cases:
- harmless planning edit → direct allowed mutation under policy;
- scope/cost/contract impact → change/approval path;
- concurrent edit → conflict/current truth;
- cached stale schedule before irreversible action → revalidate.

## 2.5. Execution control

Customer can:
- see work/stage status;
- see photos/evidence;
- comment in correct thread;
- create/observe issues;
- see blockers;
- see responsible principal;
- see expected/actual dates;
- open source entity from inbox/calendar/report.

Progress cannot be inferred from:
- queued unsent mobile action;
- material approval alone;
- calendar position alone;
- plan copied to fact.

## 2.6. Acceptance

Normal:
`contractor submit → customer review → accept`.

Rework:
`submit → customer reject/return → issue(s) → contractor fix → resubmit → accept`.

Technical supervisor:
`inspection → findings → customer sees evidence → contractor remediation → customer decision unless explicit contract gives another decision right`.

Portal:
external bounded decision uses same canonical acceptance service and exact resource authorization.

Acceptance decision records:
- exact submission/version;
- actor;
- timestamp;
- evidence snapshot/links;
- issues/reason;
- audit/outbox;
- payment eligibility effect only where contract defines it.

## 2.7. Materials

Customer scenarios:
- material need generated from scope/calculation;
- contractor/customer proposes item;
- analog/replacement proposed;
- customer approves/rejects where configured;
- price/source/as-of visible;
- one need purchased in multiple lots;
- partial delivery;
- damaged/short delivery;
- return;
- replacement;
- refund;
- receipt/warranty;
- schedule blocker cleared only from quantity truth.

## 2.8. Money

Customer sees separate layers:
- Original plan;
- Revised approved;
- Commitment;
- Actual recognized Expense;
- Payment pending/succeeded/refunded/disputed;
- Receipt/fiscal verification;
- unavailable facts.

Payment modes:
- platform payment through simulator now/real provider later;
- manual transfer evidence;
- refund/dispute where domain supports.

Never:
- invoice creation = Expense;
- upload evidence = confirmed payment;
- provider redirect = paid;
- receipt = duplicate expense;
- plan copied into fact.

## 2.9. Documents

Customer can:
- view document list;
- upload/create draft where role allows;
- view versions;
- approve/reject where relevant;
- sign exact version through in-app/simulated provider now;
- later use external provider;
- download/share authorized file;
- export project package;
- see pending/failed/unknown signature state truthfully.

## 2.10. Closeout/warranty

Before closeout verify:
- required stages/work accepted;
- required issues closed or explicitly waived under policy;
- required documents present;
- payment disputes/holds shown;
- required handover evidence available.

Then:
`complete → handover archive → warranty active → claim → responsible historical principal → fix/evidence → customer closure`.

Archive/trash/purge are different operations and never collapsed into one delete button.

---

# 3. Contractor lifecycle matrix

## 3.1. Onboarding

Contractor may enter via:
- marketplace signup;
- direct customer invite;
- team invitation from contractor organization where supported.

Profile truth may include:
- contact/identity attributes;
- NPD/provider status later;
- portfolio/evidence;
- reviews;
- service areas/categories;
- capacity/subscription entitlements.

Every verified badge has exact source/as-of; no decorative verification.

## 3.2. Lead and quote

Contractor can:
- see eligible lead;
- inspect scope enough to quote without sensitive leakage;
- send quote;
- revise/withdraw according to lifecycle;
- receive accepted/rejected/expired outcome;
- become participant atomically if selected.

Quote distinguishes:
- proposed price;
- scope assumptions;
- dates/duration;
- exclusions;
- validity;
- version.

## 3.3. My projects

Contractor sees projects from current participant authority, not hidden mutation-on-read.

Project card should expose only relevant:
- scope;
- due/attention;
- outstanding customer decisions;
- material blockers;
- invoices/payment status;
- rework/warranty obligations.

Removed participant loses future access but historical references remain.

## 3.4. Contractor principal vs team member

Principal may have:
- commercial responsibility;
- payee identity;
- contract/document responsibility;
- scope authority.

Team member may have:
- assigned work/task access;
- permitted evidence uploads;
- limited project view.

Team member does **not** automatically gain:
- invoice/payee authority;
- scope reassignment;
- sibling contractor financial access;
- contract signing authority.

## 3.5. Planning/execution

Contractor can under scope:
- propose/edit schedule where permitted;
- create WorkOrder;
- assign permitted team member;
- start stage explicitly;
- record progress;
- upload evidence;
- flag blocker;
- request material decision;
- submit for acceptance;
- receive rework;
- resubmit.

Direct WorkOrder create must be replay-safe before generic auto retry.

## 3.6. Procurement

Contractor may:
- propose material/analog;
- create approved/allowed purchase intent;
- record ordered quantity;
- record lot price;
- update delivery quantities;
- attach receipt/evidence;
- record return/replacement.

Customer-facing price and contractor internal cost/margin are separate visibility layers if contractor economics is introduced later.

## 3.7. Invoice/payment

Contractor:
- creates invoice/payment request;
- sees pending/paid/refunded/disputed;
- may attach required receipt/evidence;
- does not mark provider payment successful manually unless explicit manual-payment contract permits reviewed evidence;
- cannot see sibling contractor financial details.

## 3.8. Documents

Contractor can sign only document/version/party they are authorized to sign. Scope reassignment/removal does not rewrite already signed historical version.

## 3.9. Warranty

Warranty claim routes to historical responsible principal even if active project membership changed. Access for resolving claim is purpose-bounded and audited.

---

# 4. Self-managed customer scenario

RENOVA must support a customer running repair partially or fully without a contractor.

Customer may:
- create stages/work items for self-management where policy permits;
- buy materials;
- record expenses/receipts;
- use calendar/checklists;
- store documents/photos;
- later invite contractors for selected scopes.

Self-managed mode must not fabricate contractor/payee/signature party. Any feature that requires a real second party is marked unavailable with reason, not auto-filled with customer as contractor.

Transition:
`self-managed project → invite contractor for one scope → ProjectParticipant added → only that scope becomes contractor-managed`.

---

# 5. Multi-contractor scenario

Example:

```text
Customer C
Project P
  E1 electrician: stages S1/S2
  E2 plumber: stages S3/S4
  E3 finisher: stages S5/S6
  Supervisor T: inspection scope
```

Customer sees aggregate:
- schedule;
- revised budget;
- commitments/actual/payments;
- issues;
- material demand;
- documents/attention.

E1 sees only permitted E1 resources plus explicitly shared common context.

Mandatory negatives:
1. E1 cannot enumerate E2 private resources by guessed IDs.
2. E1 cannot receive E2 sensitive push text.
3. E1 cannot download E2 private file by stale URL.
4. E1 cannot assign own team member to E2 scope.
5. Shared Room does not imply shared commercial rights.
6. Customer can reassign future work E1→E2 while preserving E1 historical facts.
7. Removal of E1 does not affect E2/E3.
8. Aggregate budget retains principal/payee attribution.
9. Aggregate schedule does not lose dependency across principals.
10. Warranty responsibility survives participant removal.

---

# 6. Direct-invite scenario without marketplace

Required because many Russian renovation relationships originate offline.

Flow:
`customer project → invite contractor via phone/profile/link → invite delivered or durable pending → contractor logs in/registers → accepts → participant created/reactivated → scope assigned → project appears`.

Failure cases:
- phone already belongs to account;
- invite duplicate;
- invite expired/revoked;
- SMS unavailable;
- contractor declines;
- scope changed before acceptance;
- contractor already participant;
- customer lost authority;
- invite accepted after project archived.

No failure should create duplicate participant or silently assign global contractor.

---

# 7. Technical supervisor scenario

Supervisor lifecycle:
`invite/assign → limited inspection scope → inspect → evidence/finding → contractor/customer notification → remediation → verify closure`.

Supervisor may have read access broader than contractor for quality purpose but narrower than owner for finance/private docs.

Supervisor cannot by default:
- change commercial estimate;
- create payment;
- approve own payment evidence;
- become payee;
- accept work on customer’s behalf;
- sign customer/contractor agreement.

Explicit delegated authority, if ever introduced, must be a separate permission/contract, not inferred from role name.

---

# 8. Viewer/guest scenario

Viewer can be:
- family member;
- designer advisor;
- bank/retailer human reviewer only if a future product explicitly requires it — but machine integrations should use partner envelopes, not viewer access.

Viewer rules:
- read-only by default;
- resource/category scopes;
- expiry/revocation where supported;
- no generic sensitive finance/doc access;
- deeplink rechecks access;
- exported/shared artifacts follow exact scope;
- revocation blocks future downloads, not historical audit.

---

# 9. Subscription/capacity scenario

Subscription/capacity affects service entitlement, not historical project authority.

Cases:
- contractor on eligible plan;
- capacity available;
- capacity exhausted at quote/assignment;
- subscription expires mid-project;
- upgrade/downgrade;
- billing failure;
- refund.

Rules:
- accepted existing work remains accessible enough to fulfill obligations;
- new marketplace eligibility/capacity follows policy;
- no sibling principal effect;
- subscription Payment is not renovation Payment;
- real payment provider later through port.

---

# 10. Offline/network matrix

Each supported mutation is classified:

| Network outcome | UI | Persistence/retry |
|---|---|---|
| definitely not sent | queued/retryable if operation supports durable replay | same stable intent |
| sent, response success | committed | no repeat |
| sent, response lost/timeout | unknown/reconciling unless idempotent replay resolves | same id/key, never new intent automatically |
| explicit 4xx/domain refusal | refusal with reason | new deliberate intent only after correction |
| 409 version conflict | show current truth/conflict | reload + deliberate resolution |
| 5xx before known commit | operation-specific retry policy | same identity |
| app restart | recover queued/unknown | actor/session ownership preserved |

GET cache must return provenance (`fresh/stale/cache/as-of`) rather than global mutable metadata.

---

# 11. Account/session matrix

Tests must cover:
- pending request A → logout → B;
- pending request A → B → A2;
- token refresh A races logout;
- queued A job while B shares same Project access;
- project P1 request completes after P2 selected;
- file download/share completes after account switch;
- push/deeplink created for revoked scope;
- secure storage failure;
- local logout while server revoke offline.

Identity equality by `userId` alone is insufficient; generation/authority matters.

---

# 12. Archive/trash/purge matrix

States:

```text
active → archived → active
active/archived → trash → restore
trash → purge_requested → purged
```

Purge preconditions may include:
- retention period;
- legal hold;
- unresolved external operation;
- storage cleanup;
- audit policy.

Purge failure is explicit/recoverable; raw FK error or partial silent deletion is unacceptable.

---

# 13. Presentation/demo data rule

For investor/client demonstration use controlled datasets, but every action uses ordinary product path.

Allowed:
- seeded user/project;
- simulated provider lifecycle;
- deterministic examples of pending/rework/refund/offline.

Forbidden:
- fake success button;
- special project that bypasses ACL;
- hardcoded dashboard figures not from domain facts;
- payment marked paid without provider/simulator transition;
- signed document without signature lifecycle;
- customer/contractor choice that just swaps static screens.

---

# 14. Coverage status vocabulary

Every scenario/mode/action must eventually be classified:

- `SOURCE CONFIRMED` — implementation exists, terminal user result not fully proven;
- `CI VERIFIED` — exact automated evidence for stated contract;
- `NATIVE VERIFIED` — exact native build/device scenario;
- `EXTERNAL VERIFIED` — exact real provider/staging evidence;
- `PARTIAL / GAP` — bounded missing link with issue;
- `PLANNED` — governed task, not implemented;
- `NOT APPLICABLE` — reason recorded.

`screen exists`, `endpoint exists`, `simulator works`, `web demo looks good` are never standalone readiness statuses.

---

# 15. Full-product acceptance rule

RENOVA cannot be called a complete working product until at minimum:

1. M01–M12 have explicit tested disposition;
2. all primary customer/contractor actions in `USER-JOURNEY-CATALOG.md` are classified;
3. no canonical navigation action ends in placeholder/demo dead end;
4. no critical mutation has ambiguous duplicate behavior without reconciliation;
5. multi-contractor negatives are green;
6. finance projection reconciles to authoritative sources;
7. native file/deeplink/session flows are proven on required platforms;
8. simulated providers exercise real domain transitions;
9. operator can recover bounded failed external/outbox operations without inventing truth;
10. documentation/readiness/evidence refer to exact integrated SHA.

Эта матрица должна использоваться как обязательный scenario checklist при каждом крупном reconciliation pass и перед любым investor/pilot readiness verdict.