# Required PR check trigger integrity

**Status:** ACTIVE / GOVERNED ANNEX

This annex defines the source-side scheduling contract for status checks that the checked-in `main-protection` model requires on every pull request.

## Contract

A context that is globally required by repository protection must have a pull-request workflow trigger that is itself global. A required workflow must not use `pull_request.paths` or `pull_request.paths-ignore`, because a valid PR outside that filter would receive no check-run and would become permanently merge-blocked despite having no failing code.

The governed required-context set is:

- `mobile-contracts`;
- `chat-message-contracts`;
- `project-creation-contracts`;
- `acceptance-decision-contracts`;
- `stage-mutation-contracts`;
- `team-lifecycle-contracts`;
- `backend-complete`;
- `playwright-api-and-ui`;
- `source-and-runtime`;
- `security-source-contract`;
- `typecheck-integrity`;
- `snapshot`;
- `policy`.

Their owning workflows are `.github/workflows/ci.yml`, `local-runtime-integrity.yml`, `security-operations.yml`, `mobile-typecheck-fail-closed-integrity.yml`, `production-readiness-integrity.yml`, and `agent-pr-policy.yml`.

Push-side path filtering may remain bounded because the merge-protection contract is evaluated on pull-request required checks, not arbitrary push events.

## Enforcement

`scripts/governance/check-required-pr-triggers.py` fails closed when any governed workflow above:

- loses its `pull_request` trigger;
- adds `paths` or `paths-ignore` to that pull-request trigger, including inline mapping syntax;
- stops producing one of the required job/check context names;
- drifts from the exact required-context list declared by `scripts/governance/setup-github.sh`.

The guard is executed inside the universally scheduled `source-and-runtime` job. A PR that introduces a path filter into another required workflow is therefore rejected by `source-and-runtime`. If a PR filters `source-and-runtime` itself so the job does not schedule, the already-required `source-and-runtime` context remains absent and the PR fails closed rather than silently weakening protection.

This source guard is intentionally stricter than merely checking that workflow files exist: existence without a schedulable pull-request event is not a usable protected-main gate.

## Evidence boundary

This contract proves checked-in scheduling/context integrity only. It does not prove that live GitHub repository settings match the checked-in governance model, that a Code Owner/reviewer topology is satisfiable, or that an external second-agent GitHub App is installed. Those remain live-settings/external evidence under issues #247 and #370.

The live ruleset must still be read and compared before closure of #247. Source truth and live GitHub truth are separate evidence classes.

## Integration boundary

This source-side correction is the remaining trigger-integrity slice after protected-main bootstrap PR #425. It is prepared on top of the exact qualified #425 lineage so it cannot be mistaken for a workaround around that bootstrap. Before owner merge-review it must be refreshed onto the canonical `main` that actually contains #425 and then receive fresh exact-candidate CI.

It must not be used to bypass required reviews, required checks, branch protection, security gates, or owner-only repository administration.
