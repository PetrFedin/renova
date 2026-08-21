# Renova pre-launch security / abuse test

**Status: NOT EXECUTED. No external penetration-test proof is claimed.**

This checklist is the minimum adversarial review for the existing Renova product before broad production launch. It does not authorize testing against third-party provider production systems. Execute provider-related cases against approved sandbox/staging surfaces unless the provider explicitly authorizes otherwise.

## Evidence header

Every execution must record:

- test date/time and tester/organization;
- exact Renova Git SHA and backend image digest;
- mobile build/version when mobile behavior is in scope;
- environment and permitted target URLs;
- test accounts/roles and dedicated projects used;
- scope exclusions and provider restrictions;
- findings with severity, evidence, owner, disposition and retest result.

## Severity and launch rule

- **P0 / Critical** — practical account/system takeover, cross-tenant access to highly sensitive data/actions, payment integrity compromise, credential extraction, or destructive exploit with broad impact. Launch blocker.
- **P1 / High** — material unauthorized access/action, reliable privilege escalation, significant abuse path or security control bypass. High-confidence unresolved P1 is a launch blocker.
- **P2 / Medium/Low** — constrained weakness with limited impact or meaningful defense-in-depth gap. Requires owner and target date; launch disposition must be explicit.

Do not downgrade a finding merely because exploitation requires multiple normal product steps.

## Authentication and session abuse

- OTP send/verify throttling across one account, many accounts and distributed source addresses; verify no useful user-enumeration oracle.
- Incorrect, expired, replayed and concurrently submitted OTP codes.
- JWT expiry, malformed signatures, wrong token type/claims and deleted-user access.
- Refresh-token rotation and concurrent replay: only the legitimate rotation path survives; replay is rejected.
- Logout/revoke-all/access invalidation across multiple devices.
- Account deletion/anonymization followed by old access/refresh token attempts.
- Attempt to use development/test identity mechanisms (`/auth/demo`, `X-User-Id`) in staging/production.
- Brute-force and credential-stuffing style request patterns remain bounded without creating denial of service for unrelated tenants.

## Authorization / IDOR / tenant isolation

For customer, contractor, viewer/guest, technical supervisor and admin-capable test accounts:

- substitute another project's ID in every project-scoped read endpoint;
- substitute another project's ID in every project-scoped mutation endpoint;
- test nested IDs (stage, work order, payment, document, chat, purchase, issue, acceptance, schedule) from another accessible and inaccessible project;
- attempt vertical privilege escalation by changing request bodies/roles rather than UI controls;
- revoke viewer/team/supervisor access, then retry cached URLs, WebSocket access and previously valid actions;
- verify technical supervision cannot mutate commercial/payment/contractor assignment or perform final customer acceptance beyond its explicit technical capabilities;
- verify admin endpoints require the actual immutable allowlisted user identity, not only a normal contractor role.

## WebSocket and realtime

- mint and use the short-lived WebSocket ticket; reject missing/invalid/expired/wrong-purpose credentials;
- attempt chat access with a valid ticket belonging to a user without access to the thread;
- attempt inbox subscription for another user ID;
- reconnect/reuse within intended ticket TTL and verify behavior after user/project access revocation;
- verify one tenant cannot receive Redis/fan-out traffic from another tenant;
- test connection bursts, disconnect storms and malformed frames without cross-process failure or uncontrolled memory growth.

## Payments, refunds and webhook integrity

Using dedicated sandbox/test transactions only:

- spoof YooKassa webhook requests without the required secret and, where applicable, provider network trust;
- replay identical provider events concurrently and sequentially;
- submit different events for the same provider object and verify event identity semantics;
- alter amount, currency, payer/project metadata and provider payment ID;
- force retryable states, lease loss, stale claims and duplicate delivery;
- test payment confirmation before required acceptance/settlement gates;
- test refund/reversal/dispute workflows for duplicate and stale requests;
- verify a transient notification/outbox failure cannot turn an unconfirmed payment into confirmed business truth;
- inspect logs/evidence to ensure payment/provider secrets and full sensitive payloads are not leaked.

## Documents, uploads and object storage

- path traversal, encoded traversal, absolute paths and storage-key substitution;
- oversized upload, malformed multipart, MIME/extension mismatch and unsupported media;
- attempt access to another project's stored document/media URL/key;
- signed/public URL lifetime and unintended bucket/object enumeration where configured;
- document version/signature/OCR state substitution across projects;
- legal-hold/retention/delete behavior cannot be bypassed through alternate endpoints;
- verify error responses do not reveal filesystem paths, storage credentials or signed key material.

## External-provider boundaries / SSRF / degradation

- verify user-controlled input cannot redirect server-side provider HTTP clients to arbitrary hosts/localhost/private networks where such input exists;
- timeouts, malformed responses, 4xx/5xx, DNS/connect failures and provider throttling produce bounded retry/degraded states rather than false success;
- verify credentials are not included in client-visible errors/logs;
- test credential-missing/expired states fail closed in staging/production;
- reconcile provider truth after an intentionally interrupted/retried operation where the provider supports authoritative reads;
- verify operator/manual recovery path and terminal-state visibility for each implemented provider lifecycle.

The broader provider reconciliation/manual-recovery acceptance is tracked separately in **#238**; this checklist does not claim it is already complete.

## Distributed rate limiting and resource abuse

- verify shared Redis rate limiting across at least two API replicas;
- test bursts just below/above configured limits and recovery after window expiry;
- Redis unavailable/recovery behavior remains fail-closed where required by working-environment policy;
- WebSocket, webhook and normal API bursts do not bypass per-user/public limits through alternate endpoints;
- use the protected load/capacity gate from #255 for API/DB/Redis/worker pressure; do not infer security resistance from VU count alone.

## Background processing / concurrency

- duplicate outbox deliveries and competing workers do not produce duplicate business side effects;
- stale leases, fencing-token mismatch and worker crash/restart recover safely;
- Expo receipt reconciliation cannot let an old worker overwrite a newer claim/result;
- concurrent project/team/stage/work-order/technical-supervision mutations preserve invariants;
- worker failure does not remove API availability; API replica loss does not stop the remaining API/worker topology;
- poisoned/dead-letter work is visible to an operator and cannot loop indefinitely without bounds.

## Mobile/client abuse

- deep links cannot invoke privileged actions without current server authorization;
- stale local state after logout/revocation/deletion does not show a false successful mutation;
- bearer/refresh tokens are not written into URLs, analytics events, normal logs or crash breadcrumbs;
- WebSocket uses short-lived ticket flow rather than a long-lived bearer token in query parameters;
- offline/retry behavior does not duplicate financial or acceptance mutations;
- screenshots/share/export surfaces do not expose secrets or another tenant's data.

## Data lifecycle / privacy security

- authenticated export returns only the requester's allowed data;
- delete/anonymize cannot target another user;
- old sessions are revoked after deletion;
- hard-purge operation is inaccessible unless the explicit ops policy/secret/role gate is enabled;
- retention/legal-hold rules are respected during deletion and document cleanup;
- logs, telemetry, support evidence and security artifacts are checked for secrets and unnecessary sensitive content.

## Repository / supply-chain abuse

- a pull request introducing a Python advisory fails the Python advisory gate unless an exact, reviewed, unexpired exception exists;
- stale/expired Python exceptions fail;
- a synthetic/real secret in current history fails the full-history Gitleaks gate and retained evidence is redacted;
- CodeQL runs for Python and JavaScript/TypeScript;
- fixed HIGH/CRITICAL container vulnerabilities fail the existing Trivy image gate;
- reviewed lockfiles remain deterministic; no runtime/release workflow performs implicit package resolution or `latest` tooling;
- image SHA/digest/SBOM/provenance/signature evidence remains tied to the release candidate.

## GitHub / administrative review

Before launch, an authorized repository/organization owner must separately verify and record:

- `main` protection/ruleset enabled;
- required merge checks include the intended release/security gates;
- direct force push/deletion policy is appropriate;
- repository/org administrators and outside collaborators are justified;
- Actions environments, secrets, deploy keys, GitHub Apps and write-capable tokens are minimal;
- stale credentials/integrations are removed;
- production environment approvals are configured where required.

As of 2026-08-21, repository API evidence observed during this hardening reports `main` as unprotected; **#247 remains a launch blocker** until re-verified as enabled.

## Completion record

This checklist remains **NOT EXECUTED** until a tester fills the evidence header, records findings and completes retesting. CodeQL, dependency scanners, CI and internal source review do not change that status by themselves.
