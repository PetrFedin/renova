import assert from 'node:assert/strict';
import {
  idleSchedulePlanMachine,
  reduceSchedulePlanMachine,
  schedulePlanActions,
  type SchedulePlan,
} from './schedulePlanState';

function plan(status: SchedulePlan['status'], id = `plan-${status}`): SchedulePlan {
  return {
    id,
    project_id: 'project-a',
    status,
    title: 'План',
    created_by: 'user-a',
    created_at: '2026-07-30T10:00:00Z',
    updated_at: '2026-07-30T10:00:00Z',
    items: [],
  };
}

const key = 'schedule-plan:user-a:project-a';

{
  let machine = idleSchedulePlanMachine(key);
  machine = reduceSchedulePlanMachine(machine, { type: 'start', contextKey: key });
  machine = reduceSchedulePlanMachine(machine, {
    type: 'failure',
    contextKey: key,
    error: { status: 500, message: 'boom' },
  });
  assert.equal(machine.state.status, 'error');
  assert.equal(
    schedulePlanActions(machine.state, { role: 'contractor' }).canCreate,
    false,
    '500 must never unlock create',
  );
}

{
  let machine = idleSchedulePlanMachine(key);
  machine = reduceSchedulePlanMachine(machine, { type: 'start', contextKey: key });
  machine = reduceSchedulePlanMachine(machine, { type: 'absent', contextKey: key });
  assert.equal(machine.state.status, 'not_created');
  assert.equal(
    schedulePlanActions(machine.state, { role: 'contractor' }).canCreate,
    true,
    'only confirmed absence unlocks create for contractor',
  );
  assert.equal(
    schedulePlanActions(machine.state, { role: 'customer' }).canCreate,
    false,
  );
}

{
  let machine = idleSchedulePlanMachine(key);
  machine = reduceSchedulePlanMachine(machine, {
    type: 'loaded',
    contextKey: key,
    plan: plan('submitted'),
  });
  machine = reduceSchedulePlanMachine(machine, {
    type: 'start',
    contextKey: key,
    soft: true,
  });
  machine = reduceSchedulePlanMachine(machine, {
    type: 'failure',
    contextKey: key,
    error: { status: 504, message: 'timeout' },
  });
  assert.equal(machine.state.status, 'stale');
  assert.equal(
    schedulePlanActions(machine.state, { role: 'customer' }).canConfirm,
    false,
    'stale plan must be visible but immutable until reconciliation',
  );
}

{
  let machine = idleSchedulePlanMachine(key);
  machine = reduceSchedulePlanMachine(machine, {
    type: 'failure',
    contextKey: key,
    error: { status: 403, message: 'forbidden' },
  });
  assert.equal(machine.state.status, 'forbidden');
  assert.deepEqual(
    schedulePlanActions(machine.state, { role: 'contractor' }),
    {
      canCreate: false,
      canSubmit: false,
      canConfirm: false,
      canReject: false,
      immutable: false,
    },
  );
}

{
  let machine = idleSchedulePlanMachine(key);
  machine = reduceSchedulePlanMachine(machine, {
    type: 'context',
    contextKey: 'schedule-plan:user-a:project-b',
  });
  machine = reduceSchedulePlanMachine(machine, {
    type: 'loaded',
    contextKey: key,
    plan: plan('confirmed', 'stale-project-a-plan'),
  });
  assert.equal(machine.contextKey, 'schedule-plan:user-a:project-b');
  assert.equal(machine.state.status, 'idle', 'response from previous project must be ignored');
}

{
  let machine = idleSchedulePlanMachine(key);
  machine = reduceSchedulePlanMachine(machine, {
    type: 'loaded',
    contextKey: key,
    plan: plan('draft'),
  });
  assert.equal(schedulePlanActions(machine.state, { role: 'contractor' }).canSubmit, true);
  machine = reduceSchedulePlanMachine(machine, {
    type: 'loaded',
    contextKey: key,
    plan: plan('confirmed'),
  });
  assert.equal(schedulePlanActions(machine.state, { role: 'contractor' }).immutable, true);
}

console.log('schedulePlanState.test OK');
