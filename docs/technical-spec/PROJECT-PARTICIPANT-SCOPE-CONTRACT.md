# PROJECT PARTICIPANT / MULTI-CONTRACTOR SCOPE CONTRACT

Status: **FOUNDATION + LEAD SYNCHRONIZATION + MANAGEMENT API IMPLEMENTED — ISSUE #300 REMAINS OPEN UNTIL DOMAIN + MOBILE E2E ADOPTION**  
**Schema head:** `w22projectparticipants01`

This annex governs the migration from one global `Project.contractor_id` to multiple independent contractor principals in one renovation project. It is intentionally fail-closed: adding a participant record must not grant broad project access until each domain read/write path explicitly consumes participant scope.

## 1. Canonical target

One project keeps one customer-owned authoritative truth. Multiple independent contractor principals may participate without being falsely placed into another contractor's `Team`.

The transition model is:

`Project.customer_id` → customer/project owner  
`Project.contractor_id` → temporary compatibility field for the optional lead/general contractor  
`ProjectParticipant` → durable project-scoped contractor principal  
`ProjectParticipantScope` → explicit `stage | room | work_type` authorization  
`ProjectParticipantEvent` → append-only participant/scope lifecycle history

`Project.contractor_id` is **not** converted to an array and is not deleted in this migration phase. Existing domain code may continue to use it as the lead-contractor compatibility identity while independent-contractor domain paths are migrated deliberately.

## 2. Data truth and migration

Alembic `w22projectparticipants01` creates the participant, scope and event tables.

Existing non-null `Project.contractor_id` values are the only historical relationship strong enough to backfill automatically. They become:

- `participant_role = lead_contractor`;
- `status = active`;
- `all_scope = true`;
- schedule/commercial/document capability flags = true;
- one `backfilled_lead` event with `historical_actor = unknown`.

No independent contractor relationship is inferred from `Stage.assignee_id`, arbitrary `TeamMember`, chats, notifications or historical work records. Those signals are not equivalent to a project-level commercial/authorization relationship.

## 3. Current lead synchronization

All canonical runtime lead assignment must serialize on the `Project` row and commit these facts together:

1. `Project.contractor_id`;
2. exactly one active canonical `lead_contractor` participant for that user;
3. `all_scope = true` plus schedule/commercial/document compatibility flags;
4. zero narrow scope rows on the lead principal;
5. append-only participant lifecycle evidence.

`sync_current_lead_in_transaction()` never commits. The caller owns the transaction, so the compatibility field and participant truth cannot be persisted separately.

Assignment semantics:

- an unassigned project may be claimed by exactly one contractor;
- a same-contractor replay repairs participant drift and remains idempotent;
- a different contractor racing after the winner receives `already_assigned`, not a false subscription/paywall classification;
- a current lead is never silently replaced by the public assignment route;
- an independent participant promoted to current lead reuses its durable identity, clears narrow scopes and becomes canonical all-scope lead;
- stale active lead rows are deactivated if a trusted writer repairs historical drift.

The canonical atomic project-create service also synchronizes a supplied `contractor_id` before its client-write commit. Marketplace lead conversion uses that service with a stable lead-derived request identity, so a crash/retry after project commit cannot create a second project for the same conversion request.

## 4. Independent scope semantics

Independent contractors are deny-by-default:

- no scope rows + `all_scope = false` → no scoped resource access;
- `stage:<id>` → exact stage scope;
- `room:<id>` → exact room scope;
- `work_type:<value>` → exact work-type scope;
- a scope row referencing a stage/room from another project is rejected;
- removal immediately disables scope decisions while preserving participant/event history;
- reactivation without an explicit scope set clears historical scope rows and resets compatibility capability flags instead of reviving old authorization.

The scope helper treats applicable scopes as an explicit union for the resource being checked. A caller must supply a concrete stage/room/work-type context. A participant record by itself never answers a generic "can read project?" with yes.

## 5. Customer-owned participant management API

The canonical management surface is:

- `GET /projects/{project_id}/participants`;
- `POST /projects/{project_id}/participants`;
- `PATCH /projects/{project_id}/participants/{participant_id}/scopes`;
- `DELETE /projects/{project_id}/participants/{participant_id}`.

Only the owning customer may use this surface. It manages independent contractor principals and scope, not the current lead compatibility relationship. Lead scope/removal remains protected from these endpoints.

The read model exposes participant identity, role/status, current-lead truth, capability flags and explicit scope references. It does not expose phone numbers or widen generic project access.

## 6. Critical security boundary

`team_service.can_access_project()` intentionally remains unchanged for independent participants. Therefore:

- current customer/current lead contractor/team-member behavior does not widen accidentally;
- an independent participant cannot obtain generic project budget, documents, chats or admin writes merely because a participant row exists;
- each subsequent domain PR must add scope-aware filtering and negative sibling-contractor tests before enabling that domain for independent contractors.

This split is deliberate. Replacing global ACL with participant membership in one step would create an IDOR risk across sibling stages, finance and documents.

A backfilled `lead_contractor` row is compatibility evidence only. If `Project.contractor_id` later changes, the historical lead row must not continue to grant scope merely because it remains active and `all_scope=true`; only the current `Project.contractor_id` receives legacy lead compatibility access.

## 7. Mutation and concurrency contract

Participant add/reactivation and scope replacement are customer-owner mutations. They serialize on the project row before changing participant truth.

Required behavior:

- same contractor may exist at most once per project;
- repeated same add + same scope is a replay, not a second participant or second `added` event;
- removal is soft (`status=removed`) and history is retained;
- reactivation reuses the same participant identity but is a fresh authorization decision;
- reactivation with `scopes=None` returns the participant to zero-scope and resets deny-default capability flags;
- legacy/current lead contractor cannot be duplicated as an independent participant;
- lead removal/scope mutation remains on the compatibility path.

Dedicated PostgreSQL CI proves both:

1. two sessions adding the same independent participant/scope collapse to one participant, one scope and one `added` event;
2. two different contractors racing for one unassigned project's lead slot collapse to one `Project.contractor_id`, one active lead participant and one `added` event, while the loser receives `already_assigned`.

## 8. Stage assignee eligibility

The foundation exposes an eligibility decision for stage assignment:

- the current legacy lead contractor remains eligible for compatibility;
- a stale backfilled lead whose user is no longer `Project.contractor_id` is denied;
- independent participant is eligible only when the stage itself, one of its rooms, or its work type matches an active participant scope;
- unrelated sibling stage remains denied;
- a `Stage` whose `project_id` differs from the supplied `Project.id` is denied before any work-type/room matching occurs.

This helper does not by itself activate every legacy stage mutation route. Each writer that can change `assignee_id` must be migrated to this decision before #300 is closed.

## 9. Capability flags

`can_manage_schedule`, `can_manage_commercial`, and `can_manage_documents` are durable deny-default capability columns for independent participants. They remain **data-contract only** for independent contractors until the corresponding schedule/finance/document routes adopt and test them.

## 10. Remaining slices before #300 can close

The following are still required and must stay governed as open work:

1. customer mobile UX for participant add/remove/scope management;
2. scoped stages/work orders/schedule reads and mutations;
3. scoped material selections, material picks, purchase responsibility and procurement views;
4. payee/contractor attribution for payments, commitments, expenses and refunds;
5. contractor-bound documents/contracts/e-sign visibility;
6. chat thread participant/recipient rules and inbox discovery;
7. notifications/rework/automation recipients by scoped executor rather than global contractor;
8. customer combined project views while each contractor sees only its authorized scope;
9. lead replacement/removal policy and historical reassignment UX if product requirements enable it;
10. mobile golden path with customer + 2–3 independent contractors + mixed materials;
11. horizontal IDOR/security regression proving one contractor cannot read/write sibling scope.

Until those are complete, #300 remains **OPEN** and broad production readiness receives no credit for multi-contractor completeness.

## 11. Evidence boundary

Repository CI may prove schema, migration backfill, ORM parity, management API behavior, route singularity, lead synchronization and PostgreSQL concurrency for the exact candidate SHA. It does **not** prove external staging or production behavior and does not change the independent broad-production blockers in `PRODUCTION-READINESS.md`.
