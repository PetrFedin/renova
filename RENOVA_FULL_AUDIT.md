# Renova product excellence audit

## Scope

Audited the merged navigation architecture, mobile route contracts, document opening, attention surfaces, stage detail flow, and the existing API/domain boundaries. The audit also compared the construction-location work against `main` before selectively restoring its domain commits.

## Findings addressed

- duplicate navigation policy and role-blind redirects → canonical navigation policy and typed targets;
- query context loss/precedence → inbound `returnTo` is preserved;
- unsafe document links → safe URL resolver rejects empty, `javascript:` and `data:` targets;
- stage links were generic → stage context summary now exposes linked rooms, work, issues, budget and the next action;
- bank import could discard a unique payment when the statement date was older than the confidence window → amount match is retained with explicit date confidence;
- construction relations were scattered → graph domain and location resolver restored with integrity tests;
- stale Clarity regressions after merge → Home calendar entry, profile terminology, shared typography, and punch discovery restored.

## Validation

`npm run typecheck:mobile` reports 117 real errors, equal to the configured baseline. Mobile, route, domain, offline and document tests pass. Playwright has 20 passing tests, one skipped optional UI test, and two legacy UI wording timeouts that reproduce against `main`.
