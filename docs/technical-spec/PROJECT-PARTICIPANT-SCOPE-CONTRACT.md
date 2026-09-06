# PROJECT PARTICIPANT / MULTI-CONTRACTOR SCOPE CONTRACT

Status: **FOUNDATION IMPLEMENTED — ISSUE #300 REMAINS OPEN UNTIL DOMAIN + MOBILE E2E ADOPTION**

This annex governs the migration from one global `Project.contractor_id` to multiple independent contractor principals in one renovation project. It is intentionally fail-closed: adding a participant record must not grant broad project access until each domain read/write path explicitly consumes participant scope.

## 1. Canonical target

One project keeps one customer-owned authoritative truth. Multiple independent contractor principals may participate without being falsely placed into another contractor's `Team`.

The transition model is:

`Project.customer_id` → customer/project owner  
`Project.contractor_id` → temporary compatibility field for the optional lead/general contractor  
`ProjectParticipant` → durable project-scoped contractor principal  
`ProjectParticipantScope` → explicit `stage | room | work_type` authorization  
`ProjectParticipantEvent` → append-only participant/scope lifecycle history

`Project.contractor_id` is **not** converted to an array and is not deleted in the foundation slice. Existing code may continue to use it as the lead-contractor compatibility identity while domain paths are migrated deliberately.

## 2. Data truth and migration

Alembic `w22projectparticipants01` creates the participant, scope and event tables.

Existing non-null `Project.contractor_id` values are the only historical relationship strong enough to backfill automatically. They become:

- `participant_role = lead_contractor`;
- `status = active`;
- `all_scope = true`;
- schedule/commercial/document capability flags = true;
- one `backfilled_lead` event with `historical_actor = unknown`.

No independent contractor relationship is inferred from `Stage.assignee_id`, arbitrary `TeamMember`, chats, notifications or historical work records. Those signals are not equivalent to a project-level commercial/authorization relationship.

## 3. Scope semantics

Independent contractors are deny-by-default:

- no scope rows + `all_scope = false` → no scoped resource access;
- `stage:<id>` → exact stage scope;
- `room:<id>` → exact room scope;
- `work_type:<value>` → exact work-type scope;
- a scope row referencing a stage/room from another project is rejected;
- removal immediately disables scope decisions while preserving participant/event history.

The foundation helper treats applicable scopes as an explicit union for the resource being checked. A caller must supply a concrete stage/room/work-type context. A participant record by itself never answers a generic "can read project?" with yes.

## 4. Critical security boundary

During foundation rollout, `team_service.can_access_project()` intentionally remains unchanged for independent participants. Therefore:

- current customer/lead contractor/team-member behavior does not widen accidentally;
- an independent participant cannot obtain generic project budget, documents, chats or admin writes merely because a participant row exists;
- each subsequent domain PR must add scope-aware filtering and negative sibling-contractor tests before enabling that domain for independent contractors.

This temporary split is deliberate. Replacing global ACL with participant membership in one step would create an IDOR risk across sibling stages, finance and documents.

## 5. Mutation and concurrency contract

Participant add/reactivation and scope replacement are customer-owner mutations. They serialize on the project row before changing participant truth.

Required behavior:

- same contractor may exist at most once per project;
- repeated same add + same scope is a replay, not a second participant or second `added` event;
- removal is soft (`status=removed`) and history is retained;
- reactivation reuses the same participant identity;
- legacy lead contractor cannot be duplicated as an independent participant;
- lead removal/scope mutation remains on the compatibility path until lead-contract semantics are migrated.

Dedicated PostgreSQL CI proves a two-session same-participant race collapses to one participant, one scope and one `added` event.

## 6. Stage assignee eligibility

The foundation exposes an eligibility decision for stage assignment:

- legacy lead contractor remains eligible for compatibility;
- independent participant is eligible only when the stage itself, one of its rooms, or its work type matches an active participant scope;
- unrelated sibling stage remains denied.

This helper does not by itself activate every legacy stage mutation route. Each writer that can change `assignee_id` must be migrated to this decision before #300 is closed.

## 7. Capability flags

`can_manage_schedule`, `can_manage_commercial`, and `can_manage_documents` are durable deny-default capability columns for independent participants. In this foundation slice they are **data-contract only**; they must not be treated as permission until the corresponding schedule/finance/document routes adopt and test them.

## 8. Remaining slices before #300 can close

The following are still required and must stay governed as open work:

1. project participant management API + customer mobile UX;
2. lead assignment writer synchronization for projects created/assigned after `w22`;
3. scoped stages/work orders/schedule reads and mutations;
4. scoped material selections, material picks, purchase responsibility and procurement views;
5. payee/contractor attribution for payments, commitments, expenses and refunds;
6. contractor-bound documents/contracts/e-sign visibility;
7. chat thread participant/recipient rules and inbox discovery;
8. notifications/rework/automation recipients by scoped executor rather than global contractor;
9. customer combined project views while each contractor sees only its authorized scope;
10. removal/reassignment audit and historical read semantics;
11. mobile golden path with customer + 2–3 independent contractors + mixed materials;
12. horizontal IDOR/security regression proving one contractor cannot read/write sibling scope.

Until those are complete, #300 remains **OPEN** and broad production readiness receives no credit for multi-contractor completeness.

## 9. Evidence boundary

Repository CI may prove schema, migration backfill, ORM parity, scope logic and PostgreSQL concurrency for the exact candidate SHA. It does **not** prove external staging or production behavior and does not change the independent broad-production blockers in `PRODUCTION-READINESS.md`.
