# Latent capability addendum — 2026-09-15

Parent inventory: `MUTATION-LIFECYCLE-AND-LATENT-CAPABILITY-INVENTORY.md`  
Tracking: #431  
Audited default branch remains `e5c6ee44c0f684b14037e77948dbcb630fd41896` unless a row explicitly names an open PR.

This addendum records source-backed findings discovered while walking mutation families after the first inventory pass. It intentionally distinguishes **default-branch capabilities** from **open-PR capabilities** so unfinished branch work is not presented as product functionality.

## A. Default-branch capabilities with no complete ordinary UI surface

| Capability | Status | Purpose | Evidence / current gap | Product action |
|---|---|---|---|---|
| Contractor portfolio analytics (`projectsApi.getContractorAnalytics()`) | `EXPOSE_AFTER_FIX` | contractor-wide summary of projects, progress and estimated margin | mobile API exists; no ordinary UI call-site found; backend still relies on legacy `Project.contractor_id` | migrate to ProjectParticipant/scope truth (#300/#344), then expose inside contractor portfolio rather than creating another global hub |
| Compact project analytics (`projectsApi.getAnalytics()`) | `EXPOSE_AFTER_FIX` | project budget/material/progress/delay snapshot | API exists; no ordinary UI call-site found; material fact semantics are blocked by explicit-zero bug #379 and wider finance truth #318 | repair canonical facts first, then expose as a drill-down from current project/budget surfaces |
| Design package rejection (`POST /projects/{project_id}/design-packages/{id}/reject`) | `EXPOSE_AFTER_FIX` | lets the customer reject a submitted design version instead of only approving it | backend transition exists; `apps/mobile/lib/api/design.ts` exposes submit/approve but no reject method; `DesignPackageList` therefore has no reject CTA | add mobile API + customer decision UI only after design create/decision recovery blocker #413 is qualified; re-read package status/approval attention on both sides |
| Design version metadata diff (`designApi.designDiff(v1,v2)`) | `EXPOSE_AFTER_FIX` | compares two design-package versions | mobile API method exists; no call-site found. Current backend diff compares title/notes/status and a `changed` flag, not binary/PDF content | expose only with honest label such as “изменения карточки версии” or extend diff semantics before calling it document comparison |

## B. Open-PR capability layers that are implemented but are **not yet default-branch product functionality**

| Capability | PR state | Purpose | UI state | Product action |
|---|---|---|---|---|
| Project participants API client: `list / add / replaceScopes / remove` | PR #429 open, not merged | mobile consumer for multi-contractor ProjectParticipant endpoints and scope management | PR description explicitly states `No UI screen yet (part 2)` | after merge and scope qualification, add customer participant-management surface and contractor “my scoped projects” view; do not expose before #300/#344 authority truth is complete |

These rows must not be described to users as already available in the shipped/current default-branch app until their PRs are merged and the relevant E2E authority/lifecycle gates pass.

## C. Deliberately non-menu capabilities — not missing UI

The following remain contextual/alias/operator features and should **not** be promoted merely because they are hidden from ordinary navigation:

- receipt scan, stage detail, warranty claim, sync conflicts, scratchpad, budget planner, portal: contextual/deeplink workflows;
- finance-center, control, work-acceptance, work-schedule, notifications, materials-procurement, selections, design legacy route, project-analytics legacy route: redirects/aliases to canonical hubs;
- outbox dead-letter/replay, release/readiness health, provider health, audit/revenue/admin stats and content-admin CRUD: operator-only.

## D. Explicit non-findings rechecked

The following have source consumers and should not be reported as hidden functionality:

- customer portal link/share;
- portal decisions;
- project templates;
- receipt re-verification;
- material price sync;
- budget forecast/scenario surfaces;
- contract gate checks.

## E. Promotion rule

A latent capability moves to `EXPOSE_NOW` only when all of the following are true:

1. canonical authority/data truth is qualified;
2. create/update/decision/reversal semantics are known where the capability mutates state;
3. linked counters/KPIs and the second role re-read correctly;
4. retry/response-loss behavior is qualified for queued or client-originated writes;
5. the UI placement does not duplicate an existing canonical hub.

“Endpoint exists” is discovery evidence, not product completeness.
