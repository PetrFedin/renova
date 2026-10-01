import { diffRevisionItems, findOpenRevision, scheduleRevisionActions, SCHEDULE_REVISION_NOTICE } from './scheduleRevision';

let ok = true;
function assert(cond: boolean, msg: string) {
  if (!cond) { console.error('FAIL', msg); ok = false; }
}

const active = { id: 'a1', status: 'confirmed' as const };
const draft = { id: 'r1', status: 'draft' as const, supersedes_id: 'a1' };
const submitted = { id: 'r1', status: 'submitted' as const, supersedes_id: 'a1' };
const rejected = { id: 'r1', status: 'rejected' as const, supersedes_id: 'a1' };

assert(findOpenRevision(active, [draft])?.id === 'r1', 'finds open revision');
assert(findOpenRevision(active, [{ id: 'x', status: 'archived' as const, supersedes_id: 'a1' }]) === null, 'archived is not open');
assert(findOpenRevision(active, [{ id: 'x', status: 'draft' as const, supersedes_id: 'other' }]) === null, 'other chain ignored');
assert(findOpenRevision({ id: 'a1', status: 'draft' as const }, [draft]) === null, 'only confirmed schedule has revisions');
assert(findOpenRevision(null, [draft]) === null, 'no active');

const base = { canManage: true, active };
const lead = scheduleRevisionActions({ ...base, role: 'contractor', revision: null });
assert(lead.canRequest && lead.message === SCHEDULE_REVISION_NOTICE, 'lead can request with explanation');
assert(!scheduleRevisionActions({ ...base, role: 'contractor', canManage: false, revision: null }).canRequest, 'non-manager cannot request');
assert(!scheduleRevisionActions({ ...base, role: 'contractor', readOnly: true, revision: null }).canRequest, 'read-only cannot request');
assert(!scheduleRevisionActions({ ...base, role: 'customer', revision: null }).canRequest, 'customer does not request');
assert(scheduleRevisionActions({ ...base, role: 'customer', revision: null }).message === null, 'customer sees nothing without revision');
assert(!scheduleRevisionActions({ ...base, role: 'contractor', active: { id: 'a', status: 'draft' }, revision: null }).canRequest, 'unconfirmed schedule is edited directly');

const withDraft = scheduleRevisionActions({ ...base, role: 'contractor', revision: draft });
assert(withDraft.canSubmit && !withDraft.canRequest, 'contractor submits draft, no second request');
assert(scheduleRevisionActions({ ...base, role: 'contractor', revision: rejected }).canSubmit, 'rejected can be resubmitted');
const waiting = scheduleRevisionActions({ ...base, role: 'contractor', revision: submitted });
assert(!waiting.canSubmit && !waiting.canConfirm && waiting.message !== null, 'contractor waits for customer');
const decide = scheduleRevisionActions({ ...base, role: 'customer', revision: submitted });
assert(decide.canConfirm && decide.canReject, 'customer confirms or rejects submitted revision');
assert(!scheduleRevisionActions({ ...base, role: 'customer', revision: draft }).canConfirm, 'customer cannot confirm a draft');
assert(!scheduleRevisionActions({ ...base, role: 'customer', readOnly: true, revision: submitted }).canConfirm, 'read-only customer');

const item = (id: string, from: string, to: string) => ({ stage_id: id, title: `Этап ${id}`, planned_start_date: from, planned_finish_date: to });
const diff = diffRevisionItems(
  [item('1', '2026-10-01', '2026-10-05'), item('2', '2026-10-06', '2026-10-10')],
  [item('1', '2026-10-02', '2026-10-06'), item('3', '2026-10-11', '2026-10-12')],
);
assert(diff.length === 3, 'moved + added + removed');
assert(diff.find((c) => c.kind === 'moved')?.to === '2026-10-02 — 2026-10-06', 'moved range');
assert(diff.some((c) => c.kind === 'added') && diff.some((c) => c.kind === 'removed'), 'added and removed');
assert(diffRevisionItems([item('1', '2026-10-01', '2026-10-05')], [item('1', '2026-10-01', '2026-10-05')]).length === 0, 'no changes');

if (!ok) process.exit(1);
console.log('scheduleRevision tests passed');
