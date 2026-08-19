# JavaScript dependency security and reproducibility

Renova treats the root `package-lock.json` as the reviewed source of truth for JavaScript tooling and mobile dependencies. CI must not fetch executable test packages implicitly after review.

## Deterministic TypeScript test execution

The root workspace exact-pins `tsx` and commits npm's generated lockfile metadata. Root npm scripts invoke `tsx` directly instead of `npx tsx`; npm scripts automatically place the reviewed `node_modules/.bin` directory on `PATH`. A clean `npm ci` is therefore sufficient to reproduce the TypeScript test runner without consulting the registry during test execution.

The dependency-integrity workflow verifies that:

- `tsx` is an exact root development dependency rather than a semver range;
- the root lock declaration and `node_modules/tsx` resolved version match that exact value;
- `tsx` is marked development-only in the lockfile;
- no root package script contains `npx tsx`;
- the local binary exists after `npm ci`;
- `mobile:test` completes without an `npm warn exec` or `will be installed:` message.

## Audit policy

`npm audit --omit=dev` currently reports 19 affected dependency nodes: 10 high and 9 moderate. The apparent count is larger than the number of source advisories because npm propagates a vulnerable transitive package through Expo/Metro parents.

The direct source advisories currently observed are:

| Advisory | Package | Severity | Current path | Policy |
| --- | --- | --- | --- | --- |
| `GHSA-w3rx-r6r6-pgpr` | `image-size <=2.0.2` | high | `expo/react-native -> metro -> image-size` | temporary exception through 2026-10-31 |
| `GHSA-5p2g-fcmc-qvqq` | `image-size <=2.0.2` | high | `expo/react-native -> metro -> image-size` | temporary exception through 2026-10-31 |
| `GHSA-w5hq-g745-h8pq` | `uuid <11.1.1` | moderate | `expo config plugins -> xcode -> uuid` | visible, not high/critical blocker |

The two `image-size` advisories are denial-of-service infinite-loop parsers. In Renova they are reachable through Metro while bundling repository assets; they are not JavaScript executed inside the installed React Native application and runtime user uploads are not passed to Metro. The upstream advisory database currently lists no patched `image-size` version, and the upstream `image-size` repository is archived. npm's suggested remediation routes through incompatible Expo/React Native version changes, so Renova does not use `npm audit fix --force` or a framework downgrade to manufacture a green audit.

The `uuid` advisory remains visible in every audit artifact. The current `xcode` dependency requests `uuid ^7.0.3`; forcing `uuid 11.x` with a root override would cross the dependency's supported major range without upstream validation, so this change is not hidden inside the security gate.

## Blocking rules

`scripts/check-npm-audit-baseline.mjs` parses the provider JSON, not the human summary. It fails CI when:

- any new direct high or critical advisory appears;
- an allowed advisory changes package or severity;
- npm reports high/critical findings but their source advisory cannot be parsed;
- an exception passes its explicit review deadline.

Only the two exact `image-size` GHSA identifiers are temporarily accepted. Critical severity is never accepted by the baseline. Full and production-only audit JSON plus the mobile test log are uploaded as CI artifacts for review.

The review deadline is intentionally finite. Before or on 2026-10-31, the exception must be re-evaluated against Expo, Metro and `image-size` upstream changes; extending the deadline requires an explicit code review rather than silent CI suppression.
