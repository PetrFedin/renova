# P0 floor-plan reference authorization

Status: **candidate implementation for #377; not complete until required CI and review are green**.

This annex narrows the authorization contract for the existing floor-plan and furniture API. It does not add product scope and does not change Golden Path status.

## 1. Parent-binding rule

Path authorization is necessary but not sufficient. Before a mutation, every referenced resource must be proven to belong to the authorized project and, where the route names a parent resource, to that parent.

For:

`PATCH /projects/{project_id}/floor-plans/{plan_id}/pins/{pin_id}`

all of the following must hold before the first write:

- the caller has project write access;
- `FloorPlan.project_id == project_id`;
- `FloorPlanPin.floor_plan_id == plan_id`.

A mismatch returns privacy `404` and the foreign pin remains unchanged.

## 2. Furniture references

For:

`POST /projects/{project_id}/furniture`

optional foreign keys are accepted only when their parent project is proven:

- if `room_id` is supplied, `Room.project_id == project_id`;
- if `floor_plan_id` is supplied, `FloorPlan.project_id == project_id`.

Validation occurs before insert. A foreign or unknown reference returns privacy `404` and creates no `FurnitureItem` row.

## 3. Read-side consistency

Floor-plan punch-list projection must constrain issues by both `floor_plan_id` and `project_id`. This prevents an inconsistent legacy/corrupt row from being surfaced merely because it references the same plan identifier.

## 4. Acceptance evidence

Required before merge:

- authorized project A + plan A + pin from project B -> `404`; pin B unchanged;
- authorized project A + plan B + pin B -> `404`; pin B unchanged;
- same-project pin move remains green;
- project A + room B on furniture create -> `404`; no furniture row;
- project A + floor-plan B on furniture create -> `404`; no furniture row;
- same-project room/plan furniture create remains green;
- full backend suite and PostgreSQL migration check are green;
- required repository policy checks are green except separately documented inherited blockers.

This evidence proves only the bounded floor-reference authorization invariant. It is not GP completion, multi-contractor scope proof, native-device proof, MinIO proof, or production verification.
