# Required PR check trigger integrity

**Status:** ACTIVE / GOVERNED ANNEX

This annex defines the scheduling contract for status checks that the live `main-protection` ruleset requires on every pull request.

## Contract

A context that is globally required by the repository ruleset must have a pull-request workflow trigger that is itself global. A required workflow must not use `pull_request.paths` or `pull_request.paths-ignore`, because a valid PR outside that filter would receive no check-run and would become permanently merge-blocked despite having no failing code.

The current universally scheduled required contexts covered by this source-side guard are:

- `source-and-runtime` from `.github/workflows/local-runtime-integrity.yml`;
- `typecheck-integrity` from `.github/workflows/mobile-typecheck-fail-closed-integrity.yml`;
- `snapshot` from `.github/workflows/production-readiness-integrity.yml`.

Push-side path filtering may remain bounded because the repository ruleset evaluates pull-request required checks, not arbitrary push events.

## Enforcement

`scripts/governance/check-required-pr-triggers.py` fails closed when any governed workflow above:

- loses its `pull_request` trigger;
- adds `paths` to that trigger;
- adds `paths-ignore` to that trigger.

The guard is executed inside the universally scheduled `source-and-runtime` job, so future attempts to reintroduce a required-check scheduling deadlock fail on the same PR that introduces the regression.

## Evidence boundary

This contract proves repository-source scheduling integrity only. It does not prove that GitHub repository settings match the checked-in governance model, that a Code Owner/reviewer topology is satisfiable, or that an external GitHub App is installed. Those remain live-settings/external evidence under issue #247 and #370.

## Integration boundary

This source-side correction is the remaining trigger-integrity slice after the protected-main bootstrap PR #425. It must be qualified against the canonical `main` that contains #425 before owner merge-review. It must not be used to bypass required reviews, required checks, or branch protection.
