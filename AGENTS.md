# Renova — canonical agent engineering context

Renova is a production-oriented renovation-management platform for customers and contractors. Treat this repository as the canonical product source. Do not reason from old MVP/demo/audit snapshots when current code, CI, or `PRODUCTION-READINESS.md` provides newer truth.

## 1. Repository and change workflow

Canonical repository: `PetrFedin/renova`.

Canonical development flow:

`main` → short-lived `feature/*`, `fix/*`, `refactor/*`, or `agent/*` branch → pull request → required CI/evidence → merge to `main`.

`develop` is a stale historical branch and is **not** the integration source of truth. Do not create new work from `develop`, `feature/task-18...24`, or old July integration stacks.

Rules:
- never direct-push product changes to `main`;
- keep PRs logically bounded;
- fetch current `main`, open PRs/issues, CI, migrations, and readiness before starting a production-hardening slice;
- do not call work complete merely because code exists;
- distinguish `IMPLEMENTED`, `TESTED`, `CI VERIFIED`, `STAGING VERIFIED`, `EXTERNALLY VERIFIED`, and `PRODUCTION VERIFIED`;
- external provider/infrastructure/GitHub settings without authoritative evidence remain `NOT VERIFIED` or `EXTERNAL ACTION REQUIRED`.

The repository currently tracks an external P0 because GitHub reports `main` as unprotected. Repository code must never pretend that CI is enforced until the GitHub ruleset is actually applied and negatively tested.

## 2. Runtime architecture

Backend runtime is intentionally split into two processes built from the same immutable backend image:

- `renova-api` — FastAPI HTTP/WebSocket runtime, auth/ACL, synchronous request handling, API-local Redis bridge/heartbeat;
- `renova-worker` — durable background execution: Domain Outbox, provider reconciliation, optional automation reminders, push receipt reconciliation, and worker heartbeat.

Production-like runtime dependencies are:
- PostgreSQL — authoritative durable application state;
- Redis — shared rate limiting/runtime topology/WebSocket coordination and other explicitly configured shared state;
- S3-compatible object storage — documents/media;
- external providers only through documented integration boundaries.

Do not move durable business jobs back into API startup/background tasks. API replicas must be horizontally disposable without losing pending business work.

## 3. Database and Alembic rules

PostgreSQL is authoritative for staging/production. SQLite may exist only where an explicitly bounded local/test path still supports it; never infer production behavior from SQLite alone.

Alembic rules:
- exactly one migration head;
- no `create_all` as staging/production schema management;
- no swallowed or best-effort migration errors;
- schema-changing PRs must prove clean PostgreSQL upgrade and relevant migration-chain compatibility;
- do not rewrite migration history already consumed by shared environments;
- file/module refactors must not change schema merely for organizational convenience.

Current migration head must be derived from the migration graph/readiness gate, not copied from an old document.

## 4. Transaction and mutation rules

A critical business mutation must have an explicit transaction boundary.

When one user action represents one business operation, keep in the same database transaction whenever applicable:

`authoritative state mutation + audit/activity + DomainOutbox enqueue`.

Never create a local success state before an external provider call is safely reconcilable. Provider calls must support idempotency/reconciliation so a timeout, duplicate webhook, process crash, or retry cannot create a half-committed truth.

For concurrency-sensitive operations use database constraints plus explicit locking/fencing/version rules where necessary. Add concurrency tests for operations whose duplicate execution can affect money, acceptance, scope, permissions, or provider state.

No silent catch, silent fallback, silent retry exhaustion, or false-success UI.

## 5. Domain Outbox and worker canon

Use one generic durable pattern instead of provider-specific retry engines:

`business transaction → DomainOutbox → worker claim → provider call → retry/backoff → success | terminal/DLQ → operator recovery`.

Preserve:
- deterministic enqueue identity;
- duplicate prevention;
- lease ownership;
- stale-lease rescue;
- generation/fencing where implemented;
- bounded retries and terminal state;
- manual replay/recovery with audit;
- operational metrics/health.

A worker crash must not lose pending work.

## 6. Financial source-of-truth semantics

Do not collapse distinct financial concepts into one guessed number.

Canonical semantic intent:
- **Estimate** — planned cost/scope;
- **Commitment** — confirmed obligation;
- **Purchase** — procurement/business acquisition event;
- **Expense** — recognized project expense;
- **Payment** — cash movement/payment state;
- **Receipt** — primary/supporting evidence, not automatically another expense;
- **Refund** — reverse cash movement/economic correction;
- **Change Order** — approved scope/budget change.

Never use `max(receipt, expense, estimate_fact)` or similar heuristics as a generic de-duplication strategy. Before changing budget/spend calculations, trace the write paths and define source, recognition timing, included statuses, currency, refund/cancel/pending treatment, and reconciliation behavior.

Financial changes require tests for duplicate evidence/webhooks, partial payment, overpayment, refund/cancel, pending state, change order, dispute, and bank/provider reconciliation where relevant. One economic operation must never increase project spend twice.

## 7. Security boundaries

Authorization is fail-closed.

Production must not rely on demo/header authentication. Treat these as security boundaries requiring negative tests:
- OTP/session lifecycle;
- project/object ACL;
- customer/contractor/team/viewer/technical-supervisor/admin/operator roles;
- horizontal IDOR and cross-project access;
- admin endpoints;
- WebSocket subscriptions;
- documents/media/object storage;
- finance/payments/refunds/webhooks;
- provider callback validation;
- account deletion/anonymization/purge.

Never log plaintext credentials, full access/refresh tokens, payment secrets, provider secrets, or sensitive document contents.

Supply-chain gates include locked dependencies, CodeQL, secret scanning, vulnerability scanning, container non-root policy, SBOM/provenance/signature where configured. Do not weaken them to make a PR green.

## 8. Mobile route and UI canon

The source of truth for product navigation is `apps/mobile/lib/routeRegistry.ts` plus current navigation implementation.

Primary product areas are:
- Главная;
- Сообщения;
- Объект;
- Ремонт;
- Бюджет/Деньги.

`Сроки` is the canonical calendar hub and may appear as an optional/secondary entry point according to the registry. Secondary functions such as documents, approvals, inbox, reports, acceptance, procurement, selections, and analytics must enter through their canonical hub/redirect rather than creating a duplicate top-level product area.

Do not resurrect old tab layouts from archived docs or old PRs.

For mobile UI follow `.cursor/rules/renova-design-system.mdc` and the actual theme/UI primitives. Requirements include:
- no raw developer/runtime text in user UI;
- no duplicate hubs/primary CTAs;
- explicit loading/empty/error/stale states;
- financial and approval actions fail closed;
- deeplinks re-check auth, role, project/resource access and restore canonical navigation context;
- basic accessibility: labels, scaling, contrast, touch targets, keyboard/loading/error behavior.

## 9. Error model and API/mobile contracts

Critical mobile/API surfaces need explicit response schemas, status enums, nullable semantics, error contracts, and idempotency behavior.

Distinguish at least:
- validation error;
- authorization error;
- not found;
- conflict;
- dependency unavailable;
- provider pending;
- provider rejected;
- retryable technical failure;
- terminal business failure.

Never surface raw stack traces or opaque provider messages directly to users.

## 10. Production readiness and release identity

`PRODUCTION-READINESS.md` and `docs/production-readiness-evidence.json` are the current readiness sources of truth. Historical audit/MVP documents are not launch verdicts.

A broad-production `READY_FOR_BROAD_PRODUCTION` state must be evidence-backed. It is not enough for issue lists to be empty.

Release identity must bind the evaluated commit to exact artifacts:
- backend Git SHA;
- immutable SHA image tag;
- OCI revision;
- registry `sha256:<64 hex>` digest;
- deployed SHA/digest in external environment;
- mobile Git SHA + app version + native build identity.

Do not call isolated CI staging, synthetic restore, mocked provider success, source `app.json`, or green repository tests proof of external production behavior.

## 11. Testing expectations

Choose tests based on the touched boundary, then run the full relevant regression through CI.

At minimum consider:
- lint/typecheck/static contract checks;
- focused backend/mobile unit tests;
- PostgreSQL migration/transaction tests;
- API contract tests;
- concurrency/idempotency tests;
- security negative tests;
- Playwright API/UI E2E for user-flow changes;
- image/release/readiness gates for release-path changes.

The authoritative full backend regression runs in GitHub CI with locked Python/Poetry dependencies and PostgreSQL migration verification. Do not replace it with a smaller local subset and claim equivalent evidence.

## 12. Definition of Done

A production-facing block is not done until the applicable items are true:
- implementation is canonical, with no duplicate legacy path;
- authorization and object scope are explicit;
- error and retry semantics are explicit;
- idempotency is defined;
- transaction boundary is defined;
- concurrency risk is handled;
- audit/activity and downstream event behavior are defined;
- mobile UX has complete loading/error/success behavior;
- tests exist and relevant CI is green;
- migration impact is verified when applicable;
- documentation/readiness truth is updated;
- external integration evidence is retained or the status remains `NOT VERIFIED`.

## 13. Forbidden legacy resurrection

Do not reintroduce as canonical behavior:
- `develop`-first branching;
- old `feature/task-18...24` workflow;
- Renova v1.1/v1.2 tab maps;
- production demo/header auth;
- API-owned durable provider/background jobs;
- runtime route surgery as a new permanent pattern;
- duplicate financial sources of truth;
- mutable `latest` artifacts as release identity;
- swallowed migrations/provider failures;
- external `VERIFIED` claims without retained evidence.

When old code or documents conflict with current runtime, route registry, CI, or readiness evidence, prefer the newest authoritative source and either migrate or explicitly mark the older material historical.

## 14. Canonical local development for agents

`AGENTS.md` is the single authoritative engineering instruction set for Cursor, Claude Code and other coding agents. `CLAUDE.md` and `.cursor/rules/renova-agent-runtime.mdc` are bootstrap pointers only; do not duplicate architecture or policy into them.

The canonical local environment is **development only** and uses `env.local.example` → ignored `.env.local`. Never load `env.staging.example`, `backend/.env.staging.example`, `.env.production*`, or real provider credentials into the local runtime.

Local topology:

`PostgreSQL + Redis + MinIO + renova-api + renova-worker + optional Expo`.

The canonical Docker Compose project is **`renova-local`**. Local commands must operate only through a local Unix/npipe Docker daemon; `doctor` must refuse remote `DOCKER_HOST` or remote Docker contexts rather than treating a shared/staging daemon as local.

Use the existing root entrypoint and its explicit subcommands:

```bash
npm run dev -- doctor
npm run dev -- bootstrap
npm run dev
npm run dev -- check
npm run dev -- seed
npm run dev -- test-focused
npm run dev -- test-full
npm run dev -- logs
npm run dev -- stop
```

`npm run dev -- reset` is intentionally destructive but is constrained to the canonical **local `renova-local`** Compose project/volumes. Do not use it against shared environments.

For non-interactive backend-only agent verification:

```bash
RENOVA_DEV_NO_EXPO=1 npm run dev
npm run dev -- check
npm run dev -- test-focused
```

Required behavior:
- `doctor` verifies a local Docker context, Docker Compose, Node 20, Python 3.12.13, Poetry 2.4.1 and the repository lock files;
- `bootstrap` is the only explicit dependency-install step: `npm ci`, `poetry check --lock`, `poetry sync --no-interaction`, `pip check`;
- normal `dev` startup never installs packages opportunistically;
- startup is fail-fast: local env guard → infrastructure health → Alembic `upgrade head` → canonical runtime preflight → API/worker → `/health` + `/ready` + worker heartbeat → Expo;
- migration failure is fatal; never add `alembic ... || true` or equivalent swallowing;
- `check` must return non-zero when PostgreSQL, Redis, MinIO, API health/readiness, Alembic head or worker heartbeat is unhealthy;
- `seed` is development-only, idempotent and must refuse non-development environments;
- `test-focused` is the fast local contract gate; `test-full` is the broader local backend/mobile regression and must execute the focused gate first. GitHub Actions and dedicated PostgreSQL/E2E workflows remain stronger evidence where applicable.

A successful local run is **local TESTED evidence only**. A successful PR workflow is `CI VERIFIED` only for the exact candidate. Neither proves external staging, production provider delivery, managed backup restore, alert delivery, store release, or production readiness.
