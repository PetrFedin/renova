# Renova — mandatory end-to-end specification governance

**Status:** ACTIVE / AUTHORITATIVE ANNEX  
**Parent dossier:** `docs/RENOVA-TECHNICAL-SPECIFICATION.md`  
**Effective from:** 2026-08-29

This annex is part of the Renova living technical specification. It is not optional process documentation.

## 1. Same-change specification rule

Every change to product behavior, architecture, data, API, migrations, runtime, background processing, security/ACL, mobile/web UX, calculations, provider integrations, recovery behavior, CI/release gates or operational evidence must update the living specification in the same logical change.

A PR that changes governed behavior without updating the relevant specification section/annex is incomplete even when its code and tests are green.

## 2. Mandatory gap scan before and during every change

Before editing a bounded area, inspect the complete affected path for:

- dead ends: UI/action exists but the next state or operation is unreachable;
- broken links: entity/API/event/screen points to data or capability that is not available on the next boundary;
- duplicate sources of truth, duplicate routes, duplicate calculations or duplicate state machines;
- stale legacy paths that can still mutate authoritative state;
- missing transaction/idempotency/concurrency boundaries;
- missing error/loading/empty/retry/recovery states;
- role/ACL mismatches between UI visibility and server authority;
- migration/ORM/database drift;
- local/CI/staging/production evidence being confused with each other;
- fields or statuses written but never consumed, or consumed but never authoritatively written;
- outbox/provider operations without durable reconciliation or terminal recovery;
- screens/actions that cannot complete an end-to-end business journey;
- documentation that describes behavior no longer true in current code.

Any confirmed P0/P1 defect found by this scan must be recorded in the dossier/roadmap and either fixed in the bounded change or explicitly retained as a named blocker with owner/evidence boundary. It must not disappear into chat notes or an untracked TODO.

## 3. End-to-end continuity requirement

For every user-visible or business-critical capability, the specification must trace the complete chain where applicable:

`entry/navigation -> authorization -> input/schema -> application service -> transaction -> authoritative DB state -> outbox/provider side effect -> reconciliation -> API read model -> UI state -> retry/recovery -> audit/evidence`.

A capability is not considered complete when only one layer works. The chain must have no unexplained hand-off, duplicate authority or terminal dead end.

## 4. Source-of-truth rule

For each governed concept the specification must identify one canonical authority. Examples:

- navigation: route registry + canonical router implementation;
- database state: ORM + linear Alembic history + PostgreSQL constraints;
- financial semantics: explicit recognition/source rules, never UI heuristics;
- durable asynchronous work: DomainOutbox + dedicated worker/reconciliation;
- production readiness: `PRODUCTION-READINESS.md` + machine-readable evidence;
- engineering workflow: `AGENTS.md`;
- product/system contract: master dossier + governed annexes.

When duplicate authorities exist, the change must either consolidate them or mark one historical/deprecated with a tested migration/removal path.

## 5. Merge gate

Before a governed PR is merged, verify:

1. relevant specification/annex changed with the implementation;
2. discovered gaps/duplicates/dead ends are fixed or explicitly recorded;
3. canonical source(s) of truth are named;
4. affected end-to-end journey is traced through all changed boundaries;
5. tests cover the highest-risk failure/replay/concurrency/authorization path;
6. exact-head CI evidence exists for the candidate being merged;
7. external behavior not actually exercised remains `NOT VERIFIED`;
8. readiness/blocker state is synchronized after merge, not before.

Green code without synchronized specification is not Definition of Done.

### 5.1 Draft-transition recovery

A tooling failure must not be bypassed by pushing governed product changes directly to `main`.

If a fully qualified PR cannot leave Draft because the repository integration/tooling cannot perform the Draft -> Ready transition, the permitted recovery is:

1. record the tooling blocker on the original PR;
2. keep the original PR open until the replacement exists;
3. create a new branch from the exact qualified lineage, including any governance-only recovery update;
4. open a non-draft superseding PR to the same base with the same bounded functional ownership;
5. run and require fresh exact-head CI on the successor; prior green evidence is historical context only;
6. merge only the successor exact head after all required gates are green;
7. close the blocked Draft as `superseded`, preserving links/evidence;
8. perform the normal post-merge issue/spec/dependent-PR reconciliation.

The successor mechanism is process recovery, not permission to add unrelated scope, skip review gates, reuse stale CI, or change production-readiness claims.

## 6. Post-merge reconciliation

After merge to `main`:

- close only issues whose acceptance criteria are now present on `main`;
- update readiness evidence/status if and only if the merge changes a tracked blocker;
- rebase/refresh dependent PRs against the new canonical schema/runtime/spec;
- re-run exact-head qualification on each dependent PR;
- never reuse an older branch's green SHA as evidence for a rebased candidate.

## 7. Current ordered integration sequence

Post-merge state as of 2026-08-31:

1. **DONE:** #288 merged the canonical local runtime / agent onboarding / living specification foundation to `main` as merge commit `7bd1dceb273a7e1f26ddf2333e9199d8d498ae54`; exact successor head `46fb8aaf52c33449b3a168ee226c605a94c0d3d4` received fresh exact-head qualification before merge.
2. **DONE:** #279 and #285 are closed as completed because their acceptance criteria are present on `main`.
3. **NEXT / P0:** refresh #284 DR against merge commit `7bd1dceb273a7e1f26ddf2333e9199d8d498ae54`, current migration head `w18nativeenumparity01`, and this living specification; then require fresh exact-head DR and repository qualification. CI logical restore remains regression evidence and does not prove managed-provider backup/PITR/RPO/RTO.
4. **THEN:** qualify #282 chat atomicity/idempotency separately.
5. **THEN:** qualify #287 warranty atomicity/idempotency separately.
6. **THEN:** qualify #283 observability separately.

#286 is historical/superseded process lineage for #288 and is not a second implementation owner. Functional ownership remains separate. Compatibility updates caused by the canonical schema/spec head do not transfer feature ownership between these PRs.
