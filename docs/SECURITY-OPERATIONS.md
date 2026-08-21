# Renova security operations

## Purpose and truth boundary

This document defines Renova's repository-side production security operations policy. It distinguishes controls that the repository can prove automatically from controls that require GitHub/account/provider administration or an independent security assessment.

A green repository pipeline is necessary but is not by itself proof that production is secure. In particular, branch protection, repository administrator review, provider credential rotation, and an external penetration/abuse test are external operating controls and must never be inferred from passing source tests.

## Repository-enforced controls

The current security control surface includes independent layers:

| Layer | Repository control | Policy |
|---|---|---|
| JavaScript dependencies | `JS dependency integrity` | reviewed lockfile plus bounded production advisory baseline; no forced audit fix |
| Python production dependencies | `Security operations integrity / python-runtime-advisories` | audit the exact Poetry production environment against OSV; every advisory must be fixed or explicitly time-bounded |
| Container OS/libraries | `Backend image integrity` | Trivy blocks fixed HIGH/CRITICAL findings; unfixed findings remain visible rather than forcing unsafe upgrades |
| Secret exposure | `Security operations integrity / full-history-secret-scan` | scan merged base history plus the complete proposed working tree with redaction, a runtime-only detection canary, and only narrow evidence-backed false-positive exceptions |
| Static application analysis | `CodeQL SAST` | analyze Python and JavaScript/TypeScript and publish code-scanning findings |
| Immutable release | backend image/release integrity workflows | exact Git SHA, image digest, SBOM/provenance and signing remain separate release controls |

These controls are complementary. Passing one does not waive another.

## Python advisory exception policy

`security/python-audit-baseline.json` starts empty. The audit targets the exact locked production dependency environment and uses the OSV vulnerability service explicitly. A dependency advisory is not accepted merely because it is inconvenient to fix.

A temporary exception is permitted only when all of the following are true:

- the exact package and installed version are recorded;
- the exact vulnerability identifier or one of its aliases is recorded;
- a concrete review issue exists in this repository;
- the exception contains a substantive reason explaining fixability, compatibility or provider constraints;
- the exception expires no more than 90 days after review;
- the exception is removed when the finding disappears or the dependency version changes.

The evaluator fails on expired, overlong, duplicate or stale exceptions. Exact duplicate advisory records from a feed are normalized only when package, installed version and primary advisory identifier are identical; distinct advisory identifiers remain distinct findings. `pip-audit --fix`, broad dependency replacement and forced upgrades are not part of this gate.

A scanner/feed mismatch is not converted into a baseline exception without verification. During initial rollout, the default pip-audit/PyPI path reported `PYSEC-2024-232` against `python-jose 3.5.0`; the package metadata and OSV/PyPA affected range showed that 3.5.0 is outside that vulnerable range. The gate was therefore switched to explicit OSV evaluation and the baseline was kept empty rather than suppressing an unverified finding.

The explicit OSV run then found a separate real runtime finding: `ecdsa 0.19.2 / PYSEC-2026-1325`, introduced through the `python-jose` dependency chain. Renova's access-token implementation uses HS256 only and already had PyJWT 2.13.0 in the locked production graph. The remediation was therefore to remove `python-jose` from production, make `PyJWT==2.13.0` a direct dependency, migrate the JWT/error imports, regenerate the Poetry lock with Poetry 2.4.1 on Python 3.12.13, and retain the advisory baseline empty. The vulnerable dependency is not accepted through an exception.

## Secret exposure policy

Secrets, credentials, private keys and production tokens must never be committed to Git, including test fixtures, examples, logs or generated artifacts.

The Gitleaks job uses two complementary scopes. On a pull request it scans the merged base branch history (`origin/${BASE_REF}`) as the production-history truth, then separately scans the complete proposed current tree. This is deliberate for squash-merge development: ephemeral feature-branch commits that will not enter `main` do not become permanent production-history findings, while every file proposed for merge is still scanned. On `main`, the base-history scope resolves to `main` itself.

Both scopes run with redaction. Raw scanner output is deleted before evidence upload. Retained evidence contains only bounded metadata such as rule, file, line, commit and fingerprint; it does not persist the detected secret, matching string or source-line content.

The scanner runtime is immutable and also has to pass a synthetic-secret canary before repository scanning. The complete canary value is assembled only inside the runner from separate fragments; the detectable value is not committed to source. This prevents a broken scanner release from silently producing a green result without adding a permanent fake credential to Git history. Renova currently pins Gitleaks v8.30.0 rather than v8.30.1 because a regression report exists for v8.30.1's detection behavior.

The initial merged-history scan identified one synthetic e-sign idempotency test value in `backend/tests/test_esign_idempotency_key.py`, repeated in two historical commits. The repository allowlist is therefore intentionally limited to the conjunction of the `generic-api-key` rule, that exact test path, and that exact synthetic test line. It is not a rule-wide, path-wide or commit-wide suppression.

If a real credential is discovered in Git history, deleting the current file or rewriting Git history is **not** sufficient evidence of remediation. Treat the credential as exposed and perform this sequence:

1. revoke or rotate the credential at the authoritative provider;
2. determine the exposure window and affected scope;
3. remove the credential from the current repository and prevent recurrence;
4. invalidate dependent sessions/tokens where applicable;
5. redeploy the reviewed immutable artifact with the replacement credential;
6. verify secret scanning and relevant provider/release health;
7. record incident evidence and follow-up actions.

A narrow scanner allowlist is acceptable only for a demonstrable false positive and must match the smallest safe path/rule/pattern. An actual credential must never be allowlisted merely to make CI green.

## Credential rotation

Renova's operational target for manually managed long-lived credentials is rotation within 90 days unless the provider supplies a shorter-lived or automatically rotated mechanism. Exposure suspicion, access-role changes, provider compromise or unauthorized access trigger immediate rotation regardless of age.

The inventory requiring an owner and rotation procedure includes, when configured:

- `SECRET_KEY` used for application JWT signing;
- YooKassa shop/API/webhook credentials;
- Twilio credentials and sender configuration;
- Kontur/e-sign and Goskey integration credentials;
- S3/object-storage credentials and signing keys;
- SMTP credentials;
- Sentry/OTLP ingestion credentials;
- FNS receipt and Moy Nalog credentials;
- staging/admin/load-test bearer credentials and any deployment-provider tokens.

Rotating `SECRET_KEY` invalidates tokens signed with the previous key under the current single-key design. It therefore requires a controlled maintenance/release event rather than silent in-place replacement. This document does not introduce multi-key JWT support.

A real provider credential-rotation drill requires access to the authoritative provider/account and remains external evidence; CI cannot prove that a production credential was actually revoked and replaced.

## Least privilege

Production credentials must be scoped to the minimum required action and environment.

Required operating model:

- application runtime database credentials should be limited to application DML needed by the deployed service;
- schema migration/DDL should use a separately controlled deployment or migration identity where the database platform supports it;
- object-storage credentials should be limited to the Renova bucket/prefix and required object operations only;
- provider credentials must be separated between staging and production and restricted to the actual integration capability;
- API and worker runtime identities should receive only secrets needed by their process role where the deployment platform supports per-service secret scoping;
- GitHub Actions should use the minimum workflow permissions and prefer `GITHUB_TOKEN`/OIDC over long-lived personal access tokens where supported;
- production admin access must be explicit, reviewable and removed when no longer required;
- local/demo credentials must never be reusable as staging/production credentials.

## Branch and repository governance

As verified through the GitHub repository API on **2026-08-21**, `main` reports `protected: false` and no required status checks. Therefore branch-governance enforcement is **NOT PROVEN / NOT READY** even though CI workflows exist. This remains tracked by **#247** and is an external launch blocker until GitHub branch protection/rulesets are enabled and re-verified.

The repository connector available to this implementation does not provide a complete authoritative enumeration/modification workflow for every repository administrator and external organization permission. Repository/admin access review is therefore **NOT PROVEN** here. The real administrative review is tracked by **#256**. Before launch, an authorized owner must review organization/repository administrators, outside collaborators, deploy keys, GitHub Apps, Actions environments/secrets and write-capable tokens. Repeat the review at least quarterly and after personnel/access changes.

A workflow being green is not equivalent to that workflow being required for merge while `main` remains unprotected.

## Code scanning and penetration testing

CodeQL is static analysis, not a penetration test. Dependency, container and secret scanners also do not replace adversarial testing of the running product.

The pre-launch abuse/penetration checklist is maintained in `docs/PRELAUNCH-SECURITY-TEST.md`. Its initial status is **NOT EXECUTED**. Execution by an independent/qualified security reviewer is tracked by **#257**. A broad production launch must not claim external penetration-test coverage until an identified tester has executed the checklist against an exact staging/release SHA and retained findings/remediation evidence.

Unresolved P0 security findings or high-confidence P1 security findings block launch. Lower-severity findings require an explicit owner, disposition and target date.

## Security incident minimum response

For a credible security incident or credential exposure:

- contain access and revoke/rotate affected credentials first;
- preserve relevant audit/security evidence without copying secrets into tickets or chat;
- invalidate sessions/access tokens if authentication material may be compromised;
- identify affected projects/users/providers and the exposure window;
- deploy only a reviewed immutable artifact after remediation;
- re-run dependency/secret/SAST/container/release gates;
- validate provider state and external logs where applicable;
- document customer/legal notification decisions separately for the launch jurisdiction;
- complete a post-incident review with concrete prevention actions.

## Launch evidence status

Repository-side scanners and policies can be proven by CI on each reviewed SHA. The following remain external evidence and must stay explicit until completed:

- GitHub `main` branch protection / required checks: **NOT PROVEN / currently observed disabled — #247**;
- repository/organization administrator review: **NOT PROVEN — #256**;
- real provider credential rotation drill: **NOT PROVEN**;
- external penetration/abuse test: **NOT EXECUTED — #257**;
- production response/on-call exercise: tracked with the wider observability/operations launch work.
