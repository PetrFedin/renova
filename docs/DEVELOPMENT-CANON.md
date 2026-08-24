# Renova development canon

This document defines the current engineering workflow and truth boundaries for production-grade Renova development. It is intentionally separate from historical MVP/audit material.

## 1. Priority order

Choose the next change by expected damage/risk if it remains unfixed:

1. integrity and production-governance bypasses;
2. security and authorization;
3. authoritative data and migration correctness;
4. financial/transactional integrity;
5. reliability/recovery;
6. observability and operator control;
7. end-to-end UX correctness;
8. new functionality.

Do not add decorative scope while a higher-priority systemic gap remains.

## 2. Evidence states

Every production-hardening statement must use the strongest level actually proven:

- `IMPLEMENTED` — code exists;
- `TESTED` — focused tests ran successfully;
- `CI VERIFIED` — canonical GitHub CI passed on the exact candidate;
- `STAGING VERIFIED` — externally deployed staging was exercised and retained evidence exists;
- `EXTERNALLY VERIFIED` — provider/infrastructure/store/security/legal evidence exists outside repository-only simulation;
- `PRODUCTION VERIFIED` — exact promoted production artifact/runtime was verified.

Never report one level as another.

## 3. Git workflow

Canonical base is current `main`.

`main → short-lived branch → PR → relevant CI/evidence → merge`.

Do not base new work on stale `develop`, July integration stacks, or numbered historical task branches. Long-lived PRs must be compared with current `main` before any reuse.

Branch protection is a repository setting, not a code property. Until GitHub reports real `main` protection/ruleset enforcement and a negative test proves a non-compliant merge/direct push is blocked, this remains an external P0 regardless of CI quality.

## 4. Runtime topology

Production-oriented backend topology:

```text
Mobile
  ↓
FastAPI API replicas
  ↓
PostgreSQL authoritative state
  ↓
atomic business transaction
  ├─ state change
  ├─ audit/activity
  └─ DomainOutbox
       ↓
 dedicated renova-worker
       ↓
 external providers
       ↓
 reconciliation / retry / terminal recovery
```

Shared runtime dependencies include Redis and S3-compatible storage when enabled by environment policy.

API and worker are separate processes from the same immutable backend image. Durable provider/background work must not depend on one API process remaining alive.

## 5. Environment truth

### Local development

Current repository local development is **not yet topology-complete**. `scripts/start-dev.sh` is a legacy launcher that starts API + Expo and currently contains best-effort migration/package behavior. Until the local-runtime hardening PR lands, do not treat `npm run dev` as equivalent to staging.

Target local topology:

`PostgreSQL + Redis + MinIO + API + Worker + Expo`, optional OTel/Jaeger/Grafana profile.

Required future startup behavior:

`prerequisites → locked dependency validation → infra health → Alembic migration → runtime preflight → API → worker → /health → /ready → worker heartbeat → Expo`.

Migration failure must abort startup.

### CI

Canonical CI uses locked dependencies and PostgreSQL for backend verification. Full backend regression and migration checks in GitHub Actions are stronger evidence than a local SQLite/small-subset pass.

### External staging

External staging must be production-like and retain exact Git SHA + OCI digest + deployment identity. Isolated CI service containers are not external staging evidence.

### Production

Production promotion must reference the exact immutable artifact already validated for release. Do not rebuild a "same code" image and call it the same artifact.

## 6. Dependency contract

Backend dependency contract is pinned by repository configuration and lock file. Follow the exact Python/Poetry versions used by CI; run lock validation and `pip check` rather than installing packages opportunistically from startup scripts.

Do not mix broad dependency upgrades with unrelated functional changes.

## 7. Database and migration contract

- PostgreSQL is authoritative for shared environments;
- Alembic has exactly one head;
- no staging/production `create_all` schema management;
- no swallowed migration errors;
- schema-changing PRs prove clean PostgreSQL upgrade and required prior-schema path;
- do not rewrite applied migration history;
- file/module decomposition must preserve schema/API behavior unless a schema change is independently justified.

## 8. Critical mutation contract

For actions affecting money, scope, acceptance, permissions, documents/provider state, or project lifecycle:

- define authorization;
- define pre/post state;
- define idempotency key/constraint behavior;
- define transaction boundary;
- define concurrency policy;
- create audit/activity evidence;
- enqueue downstream durable events in the same transaction when part of the same business operation;
- define retry/duplicate/network-interruption behavior;
- define mobile success/error state.

External calls must not leave an unrecoverable half-commit.

## 9. Finance contract

Keep plan, obligation, recognized expense, payment, receipt evidence, refund and scope change semantically distinct.

Before changing a financial KPI, document:
- authoritative table/source;
- recognition point;
- included/excluded statuses;
- currency behavior;
- pending/cancel/refund treatment;
- duplicate/reconciliation rules.

One real-world operation must never increase project spend twice because both an expense and its receipt/payment were counted independently.

## 10. Outbox/provider contract

Use the generic durable path rather than provider-specific background retry loops:

`business tx → DomainOutbox → claim/lease → provider → retry/backoff → success | terminal/DLQ → audited operator replay/recovery`.

Preserve duplicate prevention, lease expiry/rescue, fencing where applicable, and metrics/health.

Provider status is only authoritative to the extent the official provider contract supports authoritative reads/webhooks. Never invent refresh/reconciliation APIs.

## 11. Security contract

Production authorization is fail-closed. Demo/header auth is not production authentication.

High-risk review areas:
- OTP/session issue/expiry/revocation/replay;
- cross-project IDOR;
- role escalation;
- admin/operator endpoints;
- WebSocket scope;
- documents/media/S3 access;
- payment/refund/provider webhooks;
- account deletion/purge;
- secrets in logs/errors.

Every security boundary change requires negative tests.

## 12. Mobile/navigation contract

`apps/mobile/lib/routeRegistry.ts` is the navigation source of truth.

Do not create another top-level hub for functionality that belongs to existing product pillars. Legacy paths may redirect, but should not evolve into a second canonical workflow.

Follow `.cursor/rules/renova-design-system.mdc` for UI primitives/tokens. Production UX includes loading, empty, error, stale and recovery states—not just happy-path layout.

Critical approval/payment actions must show success only after authoritative server confirmation.

## 13. Error contract

Keep business and technical failures distinguishable:

`validation | authorization | not_found | conflict | dependency_unavailable | provider_pending | provider_rejected | retryable_technical | terminal_business`.

User-facing UI must translate these into actionable human language and never expose raw stack/provider secrets.

## 14. Required verification by change type

### Documentation/governance only
- source-of-truth consistency;
- stale-instruction scan;
- applicable repository CI.

### Mobile/domain UI
- TypeScript/typecheck;
- focused domain/UI tests;
- route/deeplink/ACL contracts when touched;
- Playwright/manual device path when user journey changes.

### Backend business logic
- focused tests;
- full relevant backend regression;
- authorization negatives;
- idempotency/concurrency tests if mutation;
- PostgreSQL path.

### Database
- Alembic single head;
- clean PostgreSQL upgrade;
- supported prior-schema upgrade;
- data/constraint verification.

### Release/runtime/security
- exact release/readiness/image/security gates;
- retained artifact/evidence identity;
- no external VERIFIED claim without authoritative evidence.

## 15. Production-readiness contract

`PRODUCTION-READINESS.md` and `docs/production-readiness-evidence.json` are canonical.

Broad production remains `BLOCKED_FOR_BROAD_PRODUCTION` until all launch gates have authoritative evidence. An empty issue list alone is insufficient.

READY must bind the same candidate through:

`evaluated Git SHA = backend identity SHA = OCI revision = immutable SHA tag = external deployment SHA`, with exact registry digest retained, plus exact mobile build identity.

External staging, managed restore, real capacity, provider liveness, alert delivery, privileged-access review, independent pentest, controlled pilot, legal/privacy approval and release-store evidence must remain explicit instead of being inferred from repository tests.

## 16. Legacy handling

Old PRs/docs/routes are not automatically wrong, but they are untrusted until compared with current `main`.

Classification for old PRs:
- `MERGEABLE UNIQUE WORK`;
- `SUPERSEDED`;
- `STALE`;
- `ALREADY IMPLEMENTED ELSEWHERE`;
- `CONFLICTING`;
- `ARCHIVAL ONLY`.

Do not merge stale branches wholesale. Extract still-missing unique behavior into a clean current branch with current tests/migrations/security assumptions.

## 17. Definition of Done

A block is complete only when applicable code, auth, idempotency, transaction/concurrency, audit/outbox, UX, tests, CI, migration impact, documentation and production-impact truth are all addressed.

For external integrations/environments, "done" additionally requires retained sandbox/live/operator evidence. Otherwise the correct state is `NOT VERIFIED`.