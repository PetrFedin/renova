# Renova stabilization audit — 2026-07-30

## Scope

System audit track for production hardening:

- calculation integrity;
- duplicate prevention;
- state consistency;
- async flows;
- UI navigation correctness;
- performance regressions;
- regression coverage.

## Current priority queue

### P0 Financial truth

- Budget ledger must never recreate protected financial facts.
- Refund/dispute/deleted states are evidence states and cannot be overwritten by source hydration.
- Duplicate resolution must be deterministic and timezone safe.

### P0 State machine integrity

Validate:

- loading != empty;
- error != missing data;
- stale data handling;
- retry behaviour;
- project context switching;
- duplicate websocket events.

### P1 UX correctness

Remove:

- duplicate navigation paths;
- misleading counters;
- dead ends;
- impossible actions;
- demo-only states presented as production.

### P1 Performance

Audit:

- repeated API calls;
- unnecessary renders;
- race conditions;
- memory leaks;
- background synchronization storms.

## Rule

Every functional correction must include:

1. source code change;
2. regression test;
3. documented contract;
4. verification evidence.

No feature is considered complete until the related state transitions and calculations are verified.