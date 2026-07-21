/**
 * SchedulePlanState — not_created ≠ error.
 * Run: npx tsx apps/mobile/lib/domain/schedulePlanState.test.ts
 */
import {
  idleSchedulePlanMachine,
  reduceSchedulePlanMachine,
  schedulePlanActions,
  schedulePlanFromState,
  schedulePlanStatusLabel,
  mapWorkScheduleToState,
  type SchedulePlan,
} from './schedulePlanState';
import { normalizeAppError } from '../async/appError';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function plan(status: SchedulePlan['status'], id = 's1'): SchedulePlan {
  return {
    id,
    project_id: 'p1',
    status,
    title: 'План',
    created_by: 'u1',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    items: [],
  };
}

const KEY = 'schedule-plan:p1';
const KEY2 = 'schedule-plan:p2';

function step(m: ReturnType<typeof idleSchedulePlanMachine>, ev: Parameters<typeof reduceSchedulePlanMachine>[1]) {
  return reduceSchedulePlanMachine(m, ev);
}

// 1. плана нет (подтверждённый absence)
{
  let m = idleSchedulePlanMachine(KEY);
  m = step(m, { type: 'start', contextKey: KEY });
  assert(m.state.status === 'loading', 'loading');
  m = step(m, { type: 'absent', contextKey: KEY });
  assert(m.state.status === 'not_created', 'not_created');
  assert(schedulePlanStatusLabel(m.state).includes('не создан'), 'copy not created');
  const a = schedulePlanActions(m.state, { role: 'contractor', canManageSchedule: true });
  assert(a.canCreate, 'contractor can create');
  const cust = schedulePlanActions(m.state, { role: 'customer' });
  assert(!cust.canCreate, 'customer no create');
}

// 2. backend 500 → error, не not_created
{
  let m = idleSchedulePlanMachine(KEY);
  m = step(m, { type: 'start', contextKey: KEY });
  m = step(m, {
    type: 'failure',
    contextKey: KEY,
    error: { status: 500, message: 'boom', name: 'ApiError' },
  });
  assert(m.state.status === 'error', '500 error');
  assert(!schedulePlanStatusLabel(m.state).includes('не создан'), '500 not absent copy');
  assert(!schedulePlanActions(m.state, { role: 'contractor', canManageSchedule: true }).canCreate, 'no create on error');
}

// 3. timeout / network
{
  let m = idleSchedulePlanMachine(KEY);
  m = step(m, { type: 'start', contextKey: KEY });
  m = step(m, { type: 'failure', contextKey: KEY, error: new TypeError('Failed to fetch') });
  assert(m.state.status === 'error', 'network error');
  const err = m.state.status === 'error' ? m.state.error : null;
  assert(err?.kind === 'network', 'network kind');
}

// 4. 403 forbidden
{
  let m = idleSchedulePlanMachine(KEY);
  m = step(m, { type: 'start', contextKey: KEY });
  m = step(m, {
    type: 'failure',
    contextKey: KEY,
    error: { status: 403, message: 'nope', name: 'ApiError' },
  });
  assert(m.state.status === 'forbidden', '403');
  assert(!schedulePlanActions(m.state, { role: 'contractor' }).canCreate, 'no create forbidden');
}

// 5. successful draft
{
  let m = idleSchedulePlanMachine(KEY);
  m = step(m, { type: 'loaded', contextKey: KEY, plan: plan('draft') });
  assert(m.state.status === 'draft', 'draft');
  assert(schedulePlanActions(m.state, { role: 'contractor', canManageSchedule: true }).canSubmit, 'submit draft');
}

// 6. submitted — customer confirm/reject
{
  let m = idleSchedulePlanMachine(KEY);
  m = step(m, { type: 'loaded', contextKey: KEY, plan: plan('submitted') });
  assert(m.state.status === 'submitted', 'submitted');
  const c = schedulePlanActions(m.state, { role: 'customer' });
  assert(c.canConfirm && c.canReject, 'customer agree');
  const k = schedulePlanActions(m.state, { role: 'contractor' });
  assert(!k.canConfirm && !k.canSubmit, 'contractor wait');
}

// 7. confirmed — immutable
{
  let m = idleSchedulePlanMachine(KEY);
  m = step(m, { type: 'loaded', contextKey: KEY, plan: plan('confirmed') });
  assert(m.state.status === 'confirmed', 'confirmed');
  const a = schedulePlanActions(m.state, { role: 'customer' });
  assert(a.immutable && !a.canConfirm && !a.canReject, 'immutable');
}

// 8. refresh error → stale with plan
{
  let m = idleSchedulePlanMachine(KEY);
  m = step(m, { type: 'loaded', contextKey: KEY, plan: plan('draft') });
  m = step(m, { type: 'start', contextKey: KEY, soft: true });
  assert(m.state.status === 'draft', 'soft keeps draft');
  m = step(m, {
    type: 'failure',
    contextKey: KEY,
    error: { status: 503, message: 'down', name: 'ApiError' },
  });
  assert(m.state.status === 'stale', 'stale');
  assert(schedulePlanFromState(m.state)?.id === 's1', 'stale keeps plan');
  assert(!schedulePlanActions(m.state, { role: 'contractor', canManageSchedule: true }).canCreate, 'no create stale');
}

// 9. offline cache (had plan)
{
  let m = idleSchedulePlanMachine(KEY);
  m = step(m, { type: 'loaded', contextKey: KEY, plan: plan('submitted') });
  m = step(m, {
    type: 'failure',
    contextKey: KEY,
    error: new Error('offline'),
    offline: true,
  });
  assert(m.state.status === 'stale', 'offline stale');
  assert(m.state.status === 'stale' && m.state.error.kind === 'offline', 'offline kind');
}

// 10. project switch
{
  let m = idleSchedulePlanMachine(KEY);
  m = step(m, { type: 'loaded', contextKey: KEY, plan: plan('draft', 'old') });
  m = step(m, { type: 'context', contextKey: KEY2 });
  assert(m.state.status === 'idle' && m.contextKey === KEY2, 'switch clears');
  assert(schedulePlanFromState(m.state) == null, 'no old plan');
}

// 11. stale response ignored
{
  let m = idleSchedulePlanMachine(KEY);
  m = step(m, { type: 'start', contextKey: KEY });
  m = step(m, { type: 'context', contextKey: KEY2 });
  m = step(m, { type: 'start', contextKey: KEY2 });
  m = step(m, { type: 'loaded', contextKey: KEY, plan: plan('draft', 'leaked') });
  assert(schedulePlanFromState(m.state) == null, 'ignore stale loaded');
  m = step(m, { type: 'absent', contextKey: KEY });
  assert(m.state.status === 'loading', 'ignore stale absent');
  m = step(m, { type: 'absent', contextKey: KEY2 });
  assert(m.state.status === 'not_created', 'apply new absent');
}

// 12. роль подрядчика — create only not_created
{
  const nc = schedulePlanActions({ status: 'not_created' }, { role: 'contractor', canManageSchedule: true });
  assert(nc.canCreate, 'contractor create');
  const err = schedulePlanActions(
    { status: 'error', error: normalizeAppError({ status: 500 }) },
    { role: 'contractor', canManageSchedule: true },
  );
  assert(!err.canCreate, 'contractor no create on error');
}

// 13. роль заказчика
{
  const nc = schedulePlanActions({ status: 'not_created' }, { role: 'customer' });
  assert(!nc.canCreate, 'customer no create');
  const sub = schedulePlanActions(
    { status: 'submitted', plan: plan('submitted') },
    { role: 'customer' },
  );
  assert(sub.canConfirm && sub.canReject, 'customer actions');
}

// map archived → not_created
assert(mapWorkScheduleToState(plan('archived')).status === 'not_created', 'archived');

// rejected can submit again
{
  const a = schedulePlanActions(
    { status: 'rejected', plan: plan('rejected') },
    { role: 'contractor', canManageSchedule: true },
  );
  assert(a.canSubmit, 'resubmit rejected');
}

console.log('schedulePlanState.test OK');
