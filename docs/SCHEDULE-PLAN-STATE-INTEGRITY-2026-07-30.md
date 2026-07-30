# Schedule plan state integrity — 2026-07-30

## Defect

The schedule screen previously treated any failure of the active-plan request as if no plan existed:

- timeout / network / HTTP 500;
- access error;
- response from a previously selected project.

That false `null` state displayed “План ещё не создан” and could unlock plan creation, producing duplicates or conflicting schedules.

## Canonical states

The active schedule plan is represented by an explicit state machine:

- `idle`;
- `loading`;
- `not_created`;
- `draft`;
- `submitted`;
- `confirmed`;
- `rejected`;
- `stale`;
- `forbidden`;
- `error`.

`not_created` is allowed only after:

1. a successful response with `null`; or
2. HTTP 404 from the active-plan endpoint.

Network errors, timeouts, 5xx and 403 never become `not_created`.

## Action policy

- Create: contractor owner/foreman, only in confirmed `not_created` state.
- Submit: contractor owner/foreman, only for draft or rejected plan.
- Confirm/reject: customer, only for submitted plan.
- Stale/error/forbidden/loading: all plan mutations disabled.
- Confirmed: immutable.

## Concurrency

Each request is bound to `userId + projectId` context and a generation number.

- previous request is aborted when context or request changes;
- out-of-order responses are ignored;
- switching project cannot display or mutate the previous project’s plan.

## Cache policy

The active-plan existence request sets `cacheFallback: false`.

A durable cache may improve read-only screens, but it cannot be used to decide whether a write action such as “create plan” is safe.

## Regression gates

- `apps/mobile/lib/domain/schedulePlanState.test.ts`
- `apps/mobile/lib/schedulePlanTruthIntegrity.test.ts`
- mobile TypeScript typecheck
- existing mobile domain/UI suite
- Playwright/API and backend E2E remain mandatory
