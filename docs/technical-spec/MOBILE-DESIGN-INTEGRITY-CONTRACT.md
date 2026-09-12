# Renova — mobile design integrity contract

**Статус:** ACTIVE / governed enforcement annex  
**Область:** pull-request additions under `apps/mobile/**/*.{ts,tsx}`  
**Связь:** issue #401, #305 interaction consistency

## 1. Rollout principle

Repository-wide historical UI debt is not converted into an all-at-once cleanup. The first enforcement stage is **diff-only**: existing debt is grandfathered temporarily, but a pull request may not add new instances of the explicitly governed violations.

This keeps current `main` buildable while preventing regression during bounded migration.

## 2. Enforced additions

For mobile product source additions outside canonical token files and tests:

- no raw hex color literals; use `RenovaTheme.colors.*` or `uiTokens`;
- no explicitly banned operational emoji (`⚙`, `📷`, `🎤`, `🔒`) where the design system requires icon primitives.

Allowed token authority files:

- `apps/mobile/constants/Theme.ts`;
- `apps/mobile/constants/uiTokens.ts`.

Test files and `__tests__` are excluded because they may legitimately assert historical/raw string values.

## 3. Implementation

`scripts/mobile-design-diff-integrity.py`:

- scans only added lines in `BASE...HEAD` mobile TypeScript/TSX diff;
- ignores comments and non-product/test/token-authority files;
- reports exact path/new-line/reason;
- includes a dependency-free self-test mode.

The existing `agent-pr-policy` workflow invokes both the self-test and actual PR diff scan. No new GitHub workflow is created.

## 4. Current boundary

This first gate does **not** yet attempt to prove automatically:

- whether arbitrary user copy contains a developer/runtime concept;
- accessibility correctness of every `Pressable`;
- duplicate hub semantics beyond existing route/navigation tests;
- all possible Unicode emoji;
- historical raw colors already present before the PR.

Those require either existing semantic tests or later bounded enforcement after cleanup. The gate must not pretend broader coverage than it has.

## 5. Failure and exception policy

A violation is fixed by using the canonical token/icon. Broad regex bypasses and directory-wide exemptions are prohibited.

If a genuinely necessary product exception exists, it must be narrowly documented in the governed UI contract and implemented as the smallest explicit allowlist entry with a reason. No exception is added merely to make CI green.

## 6. Verification

- `python scripts/mobile-design-diff-integrity.py --self-test` must pass;
- PR policy runs the scanner against exact merge-base `BASE...HEAD`;
- existing agent PR template/removal/forbidden-change/test-count policy remains in the same workflow;
- this enforcement does not reduce existing test or security gates and creates no new workflow.
