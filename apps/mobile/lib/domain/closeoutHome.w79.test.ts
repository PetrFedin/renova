/**
 * W79 closeout home helpers.
 * Run: npx tsx apps/mobile/lib/domain/closeoutHome.w79.test.ts
 */
import { buildCloseoutInboxItem, closeoutNextActionTitle, mergeCloseoutInboxItem } from './closeoutHome';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(buildCloseoutInboxItem({ archived: true, ready: true, all_stages_done: true }) === null, 'archived skip');
assert(buildCloseoutInboxItem({ ready: true, all_stages_done: true })?.id === 'closeout-ready', 'ready');
assert(buildCloseoutInboxItem({ ready: false, all_stages_done: true, next_action: 'Закройте гарантию' })?.id === 'closeout-blocked', 'blocked');
assert(buildCloseoutInboxItem({ ready: false, all_stages_done: false }) === null, 'not done');

const na = closeoutNextActionTitle({ ready: true, all_stages_done: true, next_action: 'Можно завершить' });
assert(na?.ready === true && /Завершить/.test(na.title), 'hero ready');

const merged = mergeCloseoutInboxItem(
  [{ id: 'pay', kind: 'payment', title: 'P', href: '/b', priority: 85 }],
  { ready: true, all_stages_done: true },
);
assert(merged[0].id === 'closeout-ready', 'closeout sorts above payment');

console.log('closeoutHome.w79.test OK');
