## Task
Mandate ID: <A1 | B3 | ... | hotfix | governance>
Issue: #

## What

## Why
Link to mandate task / contract:

## Chain verified
<!-- mobile screen → api client → router → service → model/migration → outbox → worker → mobile. Real files only. -->
-

## Removal proof
<!-- No deletions → write exactly: no removals
     Deletions → repo-wide grep output + replacement code + test covering the replacement. -->
no removals

## Evidence
- baseline: `npm run dev -- test-focused` → N passed
- after: `npm run dev -- test-full` → N passed
- postgres integrity:
- golden paths affected:

## Out of scope / found issues
<!-- Defects outside this task → issue, not a silent fix. -->
-

## Checklist
- [ ] Passed-test count did not decrease
- [ ] No provider switched to `real`; staging/production policy not weakened
- [ ] No new workflows; no new docs outside technical-spec/ or archive/
- [ ] Legacy writers not extended
- [ ] GOLDEN-PATHS.md §Status updated if any GP status changed
