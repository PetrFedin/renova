import assert from 'node:assert/strict';

import { selectActionQueueFocus } from './actionQueuePrimary';
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

console.log('actionQueuePrimary.test OK');
