# Schedule data state integrity — 2026-07-30

## Defect

The schedule hub previously stored calendar, work orders and purchases as plain local values.

On a failed request it replaced trustworthy data with empty values:

- calendar error → `null`;
- work-order error → `[]`;
- purchase error → `[]`.

This made a network or server failure look like a valid empty business state. It also allowed a response from a previously selected project to overwrite the current project screen.

## Canonical async states

Every schedule data source now uses `AsyncResource<T>`:

- `idle`;
- `loading`;
- `refreshing`;
- `success`;
- `empty`;
- `stale`;
- `offline`;
- `error`.

The contract is explicit:

- a successful empty array is `empty`;
- a first-load failure is `error` or `offline`;
- a refresh failure with prior data is `stale` or `offline` and preserves the data;
- a failure can never become `empty`.

## Context and concurrency

Each resource is bound to `userId + projectId`.

- changing the project invalidates trust in previous data;
- the previous request is aborted;
- each load receives a generation number;
- out-of-order responses are ignored;
- a response from project A cannot populate project B.

## Read policy

The schedule hub uses dedicated fresh reads for:

- calendar;
- work orders;
- purchases.

These calls set `cacheFallback: false`. The screen itself preserves the last known data as stale, so a durable cache cannot silently turn an unavailable source into apparently current information.

## UI policy

- First calendar failure blocks the calendar and provides retry.
- Work-order failure is shown as unavailable, never as “no tasks”.
- Purchase failure marks supply events as incomplete, never as “no events”.
- A failed refresh keeps previous data visible with a stale warning and retry.
- Execution metrics are not rendered as zero when work-order data is unavailable.

## Regression gates

- `apps/mobile/lib/async/asyncResource.test.ts`
- `apps/mobile/lib/scheduleDataTruthIntegrity.test.ts`
- mobile TypeScript typecheck
- complete mobile domain/UI suite
- backend E2E and PostgreSQL migration smoke
- Playwright API suite
