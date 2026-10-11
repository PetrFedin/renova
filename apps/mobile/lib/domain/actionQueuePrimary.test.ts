import assert from 'node:assert/strict';

import { filterActionQueueRows, getActionQueueRows, selectActionQueueFocus } from './actionQueuePrimary';
import type { ResponsibilityItem, ResponsibilityQueue } from '../api/types/os';

function action(id: string, responsible_user_id: string | null): ResponsibilityItem {
  return {
    resource_type: 'issue',
    resource_id: id,
    resource_title: id,
    current_state: 'open',
    required_capability: 'field.write',
    responsible_persona: 'member',
    responsible_user_id,
    action: 'resolve_issue',
    due_at: null,
    evidence: { required: [], present: [] },
    completion_condition: 'issue.status == fixed',
    next: null,
  };
}

function queue(
  items: ResponsibilityItem[],
  buckets?: ResponsibilityQueue['buckets'],
): ResponsibilityQueue {
  return {
    project_id: 'project-1',
    count: items.length,
    items,
    ...(buckets ? { buckets } : {}),
  };
}

const otherOverdue = action('other-overdue', 'contractor');
const myOrdinary = action('my-ordinary', 'owner');
const myOverdue = action('my-overdue', 'owner');
const buckets = {
  mine_now: [myOrdinary],
  waiting_other: [],
  overdue: [otherOverdue, myOverdue],
  needs_evidence: [],
  waiting_review: [],
  waiting_owner_decision: [],
};

assert.deepEqual(
  selectActionQueueFocus(queue([otherOverdue, myOrdinary], {
    ...buckets,
    overdue: [otherOverdue],
  }), 'owner'),
  { item: myOrdinary, isMine: true },
  'another person\'s overdue item must never displace my available action',
);

assert.deepEqual(
  selectActionQueueFocus(queue([otherOverdue, myOrdinary, myOverdue], buckets), 'owner'),
  { item: myOverdue, isMine: true },
  'within my actions, retain the queue\'s operational priority',
);

assert.deepEqual(
  selectActionQueueFocus(queue([otherOverdue]), 'owner'),
  { item: otherOverdue, isMine: false },
  'other people\'s work is visible as waiting, not an actionable assignment',
);

assert.deepEqual(
  selectActionQueueFocus(queue([otherOverdue, myOrdinary], {
    ...buckets,
    overdue: [otherOverdue],
  }), 'owner', true),
  { item: otherOverdue, isMine: false },
  'read-only viewer must not be invited to perform an assigned action',
);

assert.deepEqual(
  selectActionQueueFocus(queue([otherOverdue, myOrdinary]), 'owner'),
  { item: myOrdinary, isMine: true },
  'legacy API payload without buckets still promotes the current actor',
);

assert.equal(selectActionQueueFocus(queue([]), 'owner'), null);
assert.equal(selectActionQueueFocus(null, 'owner'), null);
assert.equal(selectActionQueueFocus(queue([action('unassigned', null)]), 'owner')?.isMine, false);
assert.equal(selectActionQueueFocus(queue([myOrdinary]), '')?.isMine, false);


const list = getActionQueueRows(
  queue([otherOverdue, myOrdinary, myOverdue], buckets),
  'owner',
);
assert.deepEqual(
  list.map((row) => row.item.resource_id),
  ['my-overdue', 'my-ordinary', 'other-overdue'],
  'expanded list must put actor-owned items first and retain urgency inside each ownership group',
);
assert.deepEqual(
  filterActionQueueRows(list, 'mine').map((row) => row.item.resource_id),
  ['my-overdue', 'my-ordinary'],
  'my filter must exclude every other actor assignment',
);
assert.deepEqual(
  filterActionQueueRows(list, 'waiting').map((row) => row.item.resource_id),
  ['other-overdue'],
  'waiting filter must not offer owned actions as another actor\'s work',
);
assert.equal(filterActionQueueRows(list, 'all').length, 3);
assert.equal(list[0].bucket, 'overdue');
assert.equal(list[1].bucket, 'mine_now');
assert.equal(list[0].key, 'issue:my-overdue:resolve_issue');

const duplicates = getActionQueueRows(
  queue([myOrdinary, otherOverdue], {
    ...buckets,
    overdue: [otherOverdue, otherOverdue],
    mine_now: [myOrdinary, myOrdinary],
  }),
  'owner',
);
assert.equal(duplicates.length, 2, 'duplicate bucket entries must not create duplicate actions');

const legacy = getActionQueueRows(queue([otherOverdue, myOrdinary]), 'owner');
assert.deepEqual(legacy.map((row) => row.item.resource_id), ['my-ordinary', 'other-overdue']);
assert.ok(legacy.every((row) => row.bucket === null), 'legacy API response has unknown bucket, not invented server classifications');

const partial = getActionQueueRows(
  queue([otherOverdue, myOrdinary], {
    ...buckets,
    overdue: [otherOverdue],
    mine_now: [],
  }),
  'owner',
);
assert.deepEqual(partial.map((row) => row.item.resource_id), ['my-ordinary', 'other-overdue']);
assert.equal(partial[0].bucket, null, 'unbucketed API item should remain visible without a fabricated server bucket');

const viewer = getActionQueueRows(queue([otherOverdue, myOrdinary], {
  ...buckets,
  overdue: [otherOverdue],
}), 'owner', true);
assert.equal(filterActionQueueRows(viewer, 'mine').length, 0, 'read-only viewer has no callable assignments');
assert.equal(filterActionQueueRows(viewer, 'waiting').length, 2);
assert.deepEqual(getActionQueueRows(null, 'owner'), []);
assert.deepEqual(getActionQueueRows(queue([]), 'owner'), []);
assert.equal(getActionQueueRows(queue([action('unassigned', null)]), 'owner')[0].isMine, false);

console.log('actionQueuePrimary.test OK');
