# Waste-order recovery and post-lock authority contract

Status: normative bounded recovery contract for issue #470 / parent #316.

This annex governs the canonical waste-order mutation chain. It does not claim canonical-main integration, Golden Path completion, provider activation, or completion of the wider `floor` mutation family.

## 1. Canonical create chain

`WasteOrderList / canonical caller → floorApi.createWasteOrder → stable client_request_id before first transport attempt → one serialized request body → req → ambiguous response handling → durable offlineQueue → restart/flush → POST /projects/{project_id}/waste-orders → Project row lock → fresh project-write authorization → ClientWriteRequest replay lookup → room/project binding → WasteOrder flush → ClientWriteRequest → one commit → response`.

Required semantics:

1. `client_request_id` is created before the first network attempt and is part of the first serialized request body.
2. A queued retry persists and replays those exact serialized bytes. A restart must not mint a replacement request id.
3. Deterministic HTTP 4xx responses except 429 are authoritative and are not queued by `createWasteOrder`.
4. Transport/status-0 failures, 429, 5xx and unreadable/corrupt 2xx responses are ambiguous. They may be queued only because server-side create is replay safe.
5. Queue persistence failure is fail closed: the client must not report durable queue success if AsyncStorage did not persist the intent.
6. Same request id + same canonical payload returns the originally created `WasteOrder` with `replayed=true`.
7. Same request id + different canonical payload fails with HTTP 409 `idempotency_conflict`.
8. Two deliberate user actions with equal visible values but different request ids remain two distinct orders.
9. `room_id`, when present, must belong to the URL project. A room from another project is not accepted merely because its primary key exists.
10. Project write authority is re-evaluated after any wait for the Project row lock. Revocation while waiting fails closed.
11. `WasteOrder` and `ClientWriteRequest` are one transaction. Historical create behavior does not emit a create activity/notification, so #470 does not invent a new create side effect.
12. Failure after `WasteOrder` flush but before ledger commit rolls back both the domain row and the ledger intent. Retrying the same intent can then create exactly once.

## 2. Canonical transition chain

Direct Waste API and Approval Hub share the same lifecycle service:

`route/hub precheck → waste_order_service.transition_order → WasteOrder row lock → fresh Project + actor + team/access reload → target-role validation → state validation → status mutation + activity outbox + notification outbox → one commit → best-effort inline dispatch`.

The state machine remains unchanged:

- `draft → requested`;
- `requested → scheduled | cancelled`;
- `scheduled → done`;
- terminal `done` and `cancelled` have no outgoing transitions.

Role semantics remain unchanged:

- `requested` and `done` require the currently assigned executor (`project.contractor_id` or the applicable assigned-team owner/foreman role);
- `scheduled` and `cancelled` require the project customer.

Additional recovery/security requirements:

1. Project/actor/team authority used for the decision must be refreshed after the WasteOrder lock is acquired. A Project object loaded by a route before the lock is not authoritative after a lock wait.
2. Contractor/team revocation committed while a transition waits on the WasteOrder lock must cause the waiting transition to fail closed with no status or outbox delta.
3. Same-target replay remains idempotent and creates no duplicate durable effects.
4. Same-target replay is not an authorization bypass: current target-role is revalidated before returning `replayed=true`.
5. Transition status plus its activity/notification DomainOutbox rows remain one transaction. A preparation failure rolls all of them back.
6. Inline outbox delivery remains acceleration only; durable state/effects are already committed before delivery is attempted.

## 3. Mandatory qualification evidence

The bounded candidate is not `CANDIDATE PROVEN` unless all of the following execute on one exact candidate context:

### Mobile production transport

`node scripts/wasteOrderTransport.test.mjs` must execute the actual mobile API/client/AsyncStorage queue path and prove at minimum:

- lost-response restart replay is byte-identical;
- deterministic 400/401/403/404/409/422 do not queue;
- 429 and 5xx queue the original intent;
- transport failure queues the original intent;
- corrupt 2xx is treated as ambiguous;
- storage failure does not claim queue success;
- normal success does not queue;
- two equal-visible deliberate creates mint different request ids.

### Behavioral backend

JUnit must contain, without skip/failure/error, these exact cases:

- `test_waste_order_create_replays_original_conflicts_changed_payload_preserves_distinct_intents_and_rejects_foreign_room`;
- `test_waste_order_create_rolls_back_flushed_order_and_ledger_then_same_intent_recovers`;
- `test_waste_same_target_replay_revalidates_target_role_without_duplicate_effects`;
- `test_request_is_atomic_and_replay_does_not_duplicate_effects`.

### Migrated PostgreSQL

On an Alembic-upgraded PostgreSQL database, JUnit must contain, without skip/failure/error, these exact cases:

- `test_waste_order_create_same_key_postgres_race_reaches_project_lock_and_creates_one_result`;
- `test_waste_order_create_rechecks_revoked_contractor_after_physical_project_lock_wait`;
- `test_waste_order_transition_rechecks_revoked_contractor_after_physical_order_lock_wait`.

The PostgreSQL tests must prove physical waiting at the production lock boundary, not merely run two coroutines with `gather()`.

### Regression

The same exact candidate must also pass the repository's full backend regression, mobile contracts/typecheck, Playwright API/UI suite, and PostgreSQL Alembic upgrade. Unrelated inherited supply-chain failures must be identified by their own tracked remediation and must not be presented as waste-order evidence.

## 4. Status boundary

Passing this annex proves only the bounded waste-order create/replay and transition post-lock-authority primitive on the tested exact candidate. It does not make the change `PROVEN` on canonical `main`, does not close #316, and does not authorize starting #315/#317 before the ordered Completion Board permits it.
