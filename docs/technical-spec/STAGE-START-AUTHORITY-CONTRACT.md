# Stage Start Authority Contract

**Status:** ACTIVE / LIVING ANNEX  
**Issues:** #301, #303  
**Purpose:** define the single authoritative boundary for `planned -> active` and prevent false execution state from acceptance/dependency side effects.

## Canonical invariant

Only the canonical stage-start mutation may create execution truth:

```text
planned
→ explicit authorized start
→ actor/assignee authorization
→ signed-contract gate where applicable
→ dependency evaluation
→ active + actual_start
```

Acceptance, dependency resolution, material delivery, notifications, schedule/read-model refreshes and other side effects may make a stage *eligible*, *ready* or *unblocked*, but must not write `Stage.status = active` or `actual_start` directly.

## #301 acceptance behavior

After customer acceptance of stage A:

- stage A becomes `done`;
- acceptance/document/payment/activity/outbox semantics remain in their canonical transaction;
- the next planned stage may be returned in the response/read model for attention;
- the next stage remains `planned`;
- `actual_start` remains unset;
- user-facing copy says the next stage is ready for launch, not already started;
- an authorized executor must start it through the canonical start mutation.

This prevents acceptance from bypassing:

- assignee/execution authority;
- signed project-contract requirements;
- work/material dependency gates;
- explicit start semantics used by calendar/dashboard/read models.

## #303 dependency/material behavior

Current main still contains a separate violation in `dependency_service.on_material_delivered()`: when material dependencies become satisfied it can directly write `planned -> active`. #303 owns that mutation path and remains P0 until removed and independently qualified.

Desired behavior for #303:

```text
material/dependency becomes satisfied
→ dependency status = satisfied
→ stage readiness becomes ready/unblocked
→ stage remains planned
→ explicit canonical start by authorized actor
→ active + actual_start
```

## Mobile / UX contract

Customer and contractor surfaces must distinguish:

- `blocked` — cannot start; show concrete dependency reason;
- `ready/planned` — dependencies are satisfied, CTA may offer `Начать этап` only to an authorized actor;
- `active` — work has actually been started through canonical mutation;
- `review` — contractor requested acceptance;
- `done` — accepted/completed.

No notification, badge, card, timeline or CTA may describe a planned/ready stage as "started". Buttons must use the existing Renova design system, preserve loading/disabled/error states, minimum touch targets and canonical route/action semantics under #305.

## Verification

For #301/#304:

- focused source contract forbids acceptance-owned `next_stage.status = active` / `actual_start`;
- acceptance-decision suite must assert next stage stays `planned` with `actual_start is None`;
- stage-mutation contracts must retain actor/assignee, contract and dependency gates;
- mobile contracts and Playwright must remain green;
- full backend + PostgreSQL Alembic + exact-head CI must be green before merge.

For #303:

- real behavioral tests must prove material delivery updates dependency truth without starting the stage;
- a different assignee cannot be implicitly started;
- contractor project still cannot start before signed-contract readiness;
- self-managed customer can explicitly start after unblocking;
- calendar/dashboard/read models never receive false `active`/`actual_start`.

## Evidence status

#301/#304: **PENDING EXACT-HEAD QUALIFICATION** until the current candidate completes full backend, PostgreSQL Alembic and Playwright successfully.

#303: **OPEN P0 / NOT IMPLEMENTED**.
