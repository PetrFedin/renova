import assert from 'node:assert/strict';
import { actionQueueDestination } from './actionQueueDestination';
import type { ResponsibilityItem } from '../api/types/os';

const responsibility = (resource_type: string, action: string, resource_id = 'id-1'): ResponsibilityItem => ({
  resource_type, resource_id, action,
  resource_title: 'Test resource',
  current_state: 'pending',
  required_capability: 'test',
  responsible_persona: 'owner',
  responsible_user_id: 'owner',
  due_at: null,
  evidence: { required: [], present: [] },
  completion_condition: 'done',
  next: null,
});

assert.deepEqual(actionQueueDestination(responsibility('payment','pay_invoice','pay-a'), 'customer'), {
  pathname: '/(customer)/(tabs)/budget',
  params: { paymentId: 'pay-a', tab: 'payments' },
});
assert.deepEqual(actionQueueDestination(responsibility('payment','confirm_payment_received','pay-b'), 'contractor'), {
  pathname: '/(contractor)/(tabs)/budget',
  params: { paymentId: 'pay-b', tab: 'payments' },
});
assert.deepEqual(actionQueueDestination(responsibility('issue','resolve_issue','issue-a'), 'contractor'), {
  pathname: '/(contractor)/(tabs)/repair',
  params: { issueId: 'issue-a', tab: 'control' },
});
assert.deepEqual(actionQueueDestination(responsibility('issue','verify_remediation','issue-b'), 'customer'), {
  pathname: '/(customer)/(tabs)/repair',
  params: { issueId: 'issue-b', tab: 'control' },
});
assert.deepEqual(actionQueueDestination(responsibility('acceptance','decide_work_acceptance','accept-a'), 'customer'), {
  pathname: '/(customer)/(tabs)/repair',
  params: { acceptanceId: 'accept-a', tab: 'control' },
});
assert.equal(actionQueueDestination(responsibility('payment','verify_remediation'), 'customer'), null);
assert.equal(actionQueueDestination(responsibility('unexpected','pay_invoice'), 'customer'), null);
assert.equal(actionQueueDestination(responsibility('issue','resolve_issue','   '), 'customer'), null);
assert.equal(actionQueueDestination(responsibility('acceptance','resolve_issue'), 'customer'), null);

console.log('actionQueueDestination.test OK');
