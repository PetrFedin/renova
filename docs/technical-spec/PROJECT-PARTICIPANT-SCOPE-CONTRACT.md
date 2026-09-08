# PROJECT PARTICIPANT / MULTI-CONTRACTOR SCOPE CONTRACT

Status: **FOUNDATION + LEAD SYNCHRONIZATION + MANAGEMENT API IMPLEMENTED; HARDENING CANDIDATE REQUIRES EXACT-HEAD CI — #300 OPEN**  
**Schema head:** `w22projectparticipants01`  
**Last contract revision:** 2026-09-08

This governed annex is part of `docs/RENOVA-TECHNICAL-SPECIFICATION.md`. Independent participation does not grant generic project access. Foundation #312 is merged; management #313 is a bounded adoption slice, not completion of #300.

## 1. Canonical target and migration

One project retains one customer-owned truth. Independent firms must not be disguised as another contractor's Team.

`Project.customer_id` is the customer/owner; optional `Project.contractor_id` is the lead compatibility identity; `ProjectParticipant` is the durable project principal; `ProjectParticipantScope` holds `stage | room | work_type` grants; `ProjectParticipantEvent` preserves lifecycle history.

Migration `w22projectparticipants01` backfills only existing non-null `Project.contractor_id`: active `lead_contractor`, `all_scope=true`, three compatibility capabilities true, one `backfilled_lead` event with unknown historical actor. No independent relationship is inferred from assignees, teams, chats or notifications. The migration is not rewritten by this slice.

## 2. Lead assignment transaction

Canonical HTTP assignment serializes on Project and commits the lead identity, participant, narrow-scope cleanup and audit together. `sync_current_lead_in_transaction()` never commits and is a trusted preparation helper, not an authorization endpoint. Its caller must own a freshly locked existing project or a new project inserted in the same transaction.

Assignment outcomes distinguish `assigned`, `already_assigned`, `subscription_required`, `not_found`, `forbidden`, `project_trashed` and `contractor_invalid`. Same-lead retry is idempotent and can repair a missing compatibility row. A competing contractor does not replace an existing lead and must not receive a false paywall classification.

A locked SELECT uses `populate_existing=True`: a customer request may already hold a stale Project in the ORM identity map. Database locking alone is not proof that those attributes were refreshed. The service revalidates current customer ownership or contractor self-claim, active user/target role and project lifecycle before mutation. Trashed projects reject new assignment with HTTP 409.

Independent-to-lead promotion reuses the principal identity, removes narrow scopes and creates an audited all-scope lead. Trusted repair deactivates stale lead rows without deleting history.

## 3. Independent participant semantics

No scopes plus `all_scope=false` means no scoped access. Stage, room and work-type grants form an explicit union for a concrete resource. Cross-project stage/room references are rejected. Scope helpers consult persisted current-lead identity rather than trusting a previously loaded Project. A stale historical lead does not remain authorized because its old row says active/all-scope.

Add/reactivate/replace/remove lock and refresh the project and affected participant. They revalidate active owning-customer identity. Failure rolls back all participant/scope/audit changes and releases the transaction.

Reactivation is a fresh authorization decision: reset all compatibility flags, use role `contractor`, replace old scopes with the explicitly supplied set (or empty set). Explicit re-addition of a former lead follows the same rule and never revives broad authority. The durable principal ID and historical events are preserved.

Current leads cannot be removed or narrowed through independent-participant endpoints. Both current project identity and freshly loaded participant role guard this boundary, including a request that preloaded the row before promotion.

## 4. Customer-owned management API

- `GET /projects/{project_id}/participants` lists active participants; `include_removed=true` includes history-bearing removed rows.
- `POST /projects/{project_id}/participants` adds/reactivates an independent contractor with explicit scopes.
- `PATCH /projects/{project_id}/participants/{participant_id}/scopes` replaces the grant set.
- `DELETE /projects/{project_id}/participants/{participant_id}` soft-removes an independent participant.

Only the owning customer may use these endpoints. Responses expose identity/name, role/status, current-lead truth, capability flags, scope references and timestamps, not phone numbers. Writes to trashed projects return `project_trashed`/409. Generic project ACL remains unchanged.

## 5. Atomic marketplace conversion and recovery

The canonical HTTP conversion uses `marketplace_conversion_service.convert_lead()` and the shared `project_create_service.prepare_project_in_transaction()` preparation path.

The chain is:

`validated request -> freshly locked JobLead -> current actor/owner/assigned-contractor authorization -> replay lookup -> canonical project/rooms/estimate/stages + lead participant/audit + ProjectCreated outbox -> JobLead.taken + ClientWriteRequest -> one commit -> best-effort dispatch -> original project response`.

Ordinary/custom/template project creation also uses the shared project preparation helper. Marketplace conversion no longer calls a service that commits the project and then commits the source lead separately.

The mapping is scoped by `project.create.marketplace`, customer identity and `marketplace-lead:<lead_id>`. Its versioned fingerprint contains normalized explicit rooms/property type and lead ID, not `date.today()` or mutable display fields. Customer and assigned contractor share the same logical conversion identity after individual authorization.

A committed `taken` lead with a matching mapping returns the original project on retry, including after midnight or a lost HTTP response. Changed explicit input produces `lead_conversion_idempotency_conflict`/409. Authorization is checked before replay, so an outsider cannot use replay to discover the project.

The saved project must still exist, not be trashed, and match the current source customer/contractor. Missing/mismatched project, a taken lead without its mapping, or a quoted lead with a committed mapping is an explicit 409 requiring reconciliation. No heuristic reconstruction or silent claim of historical atomicity is allowed. Legacy/pre-candidate fingerprint mismatches are rejected, not reinterpreted.

The API validates structured room input, nonempty bounded lists, nonempty names/property type and finite dimensions. Omitted room input preserves the pre-existing default-room behavior; an explicitly empty or malformed list is a 422, not a silently substituted success.

## 6. Scope and commercial security boundary

`team_service.can_access_project()` deliberately does not accept independent participation as project-global permission. Budgets, documents, chats, generic reads/writes and administrative actions do not become available merely because a participant row exists.

`can_manage_schedule`, `can_manage_commercial`, `can_manage_documents` remain data-contract-only for independent contractors until each consuming domain adopts and tests them. Customer combined views and isolated contractor views require separate implementation.

Stage-assignee eligibility accepts current lead compatibility or a matching active stage/room/work-type grant; unrelated sibling stages and cross-project Stage objects are denied. Eligibility alone does not activate legacy stage writers or settle payee attribution.

## 7. Verification contract

The dedicated PostgreSQL workflow retains predecessor-schema backfill, CHECK constraints and ORM parity. It runs foundation, management, existing concurrency and the new hardening suite.

Required proof includes two warm sessions preloading the same project before competing for its lead slot, and customer/contractor sessions preloading the same quoted lead before conversion. Barriers and bounded timeouts replace timing guesses. Expected outcome: one winner/replay mapping/project/lead participant/audit history, not two nominal successes.

Behavioral regressions also cover persisted ownership changes, promotion after participant preload, former-lead reactivation, stale-lead scope denial, audit rollback, conversion commit failure, response-loss recovery, next-day replay, changed intent, outsider replay and actual HTTP 422 responses for malformed input.

Old green SHA `3c9d527578873111826e8e5e0253f46ddf7e4ec4` does not qualify this changed candidate. Full backend, mobile, Playwright, PostgreSQL, technical-spec, security and triggered runtime gates must pass for the final head. Local/static inspection is not PostgreSQL proof.

## 8. Named remaining blockers and adoption work

Owner for repository work: Renova engineering; tracking issue: #300 unless another issue is named. These are not completed by management API or green foundation CI.

1. Customer mobile participant/scope UX and scoped project discovery; scoped stages/work orders/schedule; combined customer views.
2. Material/procurement responsibility, contractor/payee payment/expense/refund attribution, contractor-bound documents/e-sign, chat/inbox and notification/automation recipient isolation.
3. Lead replacement/removal policy, historical reassignment UX, customer plus 2–3 contractor mobile golden path and negative sibling-scope E2E.
4. **LEGACY-WRITER-RETIREMENT:** `project_service.create_project()`/`assign_contractor()` and legacy direct API functions still contain independent mutation code; canonical HTTP handlers have been replaced, but internal/demo/direct-import compatibility must be delegated and qualified before claiming every writer is canonical. No new callers may adopt these legacy writers. Existing router replacement is transitional and must be retired, not expanded into a permanent design.
5. **CONTRACTOR-CAPACITY-SERIALIZATION:** the free-project limit counts projects while locking one project, not a contractor-wide allocation resource. Same-contractor/different-project assignment and contractor-at-create entitlement consistency need a dedicated shared capacity policy and real PostgreSQL race proof. This candidate proves the one-project lead slot, not global subscription quota enforcement.
6. **MARKETPLACE-SOURCE-TRANSITIONS:** quotation selection, automatic assignment and other JobLead writers require a shared locked transition policy. Conversion serializes and refreshes its own transaction; it does not prove every legacy quote/assignment writer is fenced against a concurrently taken lead.
7. **EXTERNAL-OPERATIONS:** #238 provider/S3 recovery and the independent staging/DR/observability/security/release blockers remain unchanged.

Issue #300 was found closed despite incomplete acceptance criteria and was reopened on 2026-09-08. Avoid closing keywords tied to #300 in intermediate PR descriptions or merge messages; reopen immediately if automation closes it prematurely.

## 9. Evidence boundary

Repository qualification is **CI VERIFIED** for the exact tested candidate only. It is not external staging, production, provider delivery, managed backup/PITR, alert delivery or full multi-contractor product acceptance. Broad launch remains `BLOCKED_FOR_BROAD_PRODUCTION`.

## 10. Source snapshot

| Source | Blob SHA | Contract |
|---|---|---|
| `backend/app/api/v1/router.py` | `8663e5b54289b133c5a2ff30af0533cfee93dfb6` | canonical HTTP assignment, conversion and management composition |
| `backend/app/services/project_assignment_service.py` | `7fa18d5b0b2dfc4413626281cb5dc4c48f286894` | refreshed locked assignment state |
| `backend/app/services/project_participant_service.py` | `110934ea99f3c71c2a2dfcc048b0c328f6482c58` | refreshed participant lifecycle and fail-closed former-lead semantics |
| `backend/app/services/project_create_service.py` | `12825d9b6128eb29ad9b53ff406b9e451e728c69` | shared non-committing preparation |
| `backend/app/services/marketplace_conversion_service.py` | `87b52419582d9f675c1101fea351b1003d6e19f2` | one transaction and date-stable replay |
| `backend/tests/test_project_participant_hardening.py` | `54993bc3bd78bc199c608fa37a7e3d611fc30ac1` | behavioral, HTTP and real PostgreSQL regressions |

Older annex snapshots remain historical evidence of their own changes; they must not be treated as the current router source.
