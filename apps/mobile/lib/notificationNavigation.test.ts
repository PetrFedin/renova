/** Run: tsx lib/notificationNavigation.test.ts (COM-002 role resolution, COM-040 deferred navigation). */
import assert from 'node:assert/strict';
import {
  createPendingNavigationQueue,
  notificationNavigationPayload,
  parseNotificationRole,
  resolveNotificationRole,
  type NotificationNavigationPayload,
  type NotificationRole,
  type NotificationSession,
} from './notificationNavigation';

// --- COM-002: role from payload, then session, never a customer default ---
assert.equal(notificationNavigationPayload({ link_path: '/control', role: 'contractor' }).role, 'contractor');
assert.equal(notificationNavigationPayload({ link_path: '/control', role: 'customer' }).role, 'customer');
assert.equal(notificationNavigationPayload({ link_path: '/control' }).role, undefined, 'missing role must stay undefined');
assert.equal(notificationNavigationPayload({ role: 'admin' }).role, undefined, 'unknown role is ignored');
assert.equal(parseNotificationRole(42), undefined);
assert.equal(notificationNavigationPayload({ return_to: '/a' }).returnTo, '/a');
assert.equal(notificationNavigationPayload({ returnTo: '/b' }).returnTo, '/b');
assert.equal(notificationNavigationPayload(undefined).linkPath, undefined);

assert.equal(resolveNotificationRole('contractor', 'customer'), 'contractor', 'payload wins');
assert.equal(resolveNotificationRole(undefined, 'contractor'), 'contractor', 'session fallback');
assert.equal(resolveNotificationRole(undefined, undefined), undefined, 'no silent customer default');

// --- COM-040: deferred navigation queue ---
type Timer = { fn: () => void; ms: number; cancelled: boolean };
function harness(initial: NotificationSession, timeoutMs = 1000) {
  const state = { session: initial };
  const opened: Array<{ p: NotificationNavigationPayload; role: NotificationRole }> = [];
  const dropped: string[] = [];
  const timers: Timer[] = [];
  const queue = createPendingNavigationQueue({
    getSession: () => state.session,
    navigate: (p, role) => opened.push({ p, role }),
    onDropped: (reason) => dropped.push(reason),
    timeoutMs,
    setTimer: (fn, ms) => { const t = { fn, ms, cancelled: false }; timers.push(t); return t; },
    clearTimer: (h) => { (h as Timer).cancelled = true; },
  });
  const fire = () => timers.filter((t) => !t.cancelled).forEach((t) => { t.cancelled = true; t.fn(); });
  return { state, opened, dropped, timers, queue, fire };
}

{ // ready session: immediate, payload role wins
  const h = harness({ status: 'authenticated', role: 'customer' });
  h.queue.push({ linkPath: '/control', role: 'contractor' });
  assert.equal(h.opened.length, 1);
  assert.equal(h.opened[0].role, 'contractor');
  assert.equal(h.timers.length, 0);
}
{ // loading session: held, flushed once with the session role
  const h = harness({ status: 'loading' });
  h.queue.push({ linkPath: '/calendar' });
  assert.equal(h.opened.length, 0, 'must not navigate before the session is restored');
  assert.equal(h.timers.length, 1);
  h.queue.sessionChanged();
  assert.equal(h.opened.length, 0, 'still loading');
  h.state.session = { status: 'authenticated', role: 'contractor' };
  h.queue.sessionChanged();
  assert.deepEqual(h.opened.map((o) => o.role), ['contractor']);
  assert.ok(h.timers[0].cancelled, 'timer cleared after flush');
  h.queue.sessionChanged();
  assert.equal(h.opened.length, 1, 'flushed exactly once');
}
{ // never waits forever
  const h = harness({ status: 'loading' }, 500);
  h.queue.push({ linkPath: '/x' });
  assert.equal(h.timers[0].ms, 500);
  h.fire();
  assert.deepEqual(h.dropped, ['timeout']);
  h.state.session = { status: 'authenticated', role: 'customer' };
  h.queue.sessionChanged();
  assert.equal(h.opened.length, 0, 'expired tap is not replayed later');
}
{ // signed out: dropped immediately and after restore
  const h = harness({ status: 'anonymous' });
  h.queue.push({ linkPath: '/x' });
  assert.deepEqual(h.dropped, ['anonymous']);
  const h2 = harness({ status: 'loading' });
  h2.queue.push({ linkPath: '/x' });
  h2.state.session = { status: 'anonymous' };
  h2.queue.sessionChanged();
  assert.deepEqual(h2.dropped, ['anonymous']);
  assert.equal(h2.opened.length, 0);
}
{ // latest tap replaces the held one; dispose cancels
  const h = harness({ status: 'loading' });
  h.queue.push({ linkPath: '/first' });
  h.queue.push({ linkPath: '/second' });
  assert.ok(h.timers[0].cancelled);
  h.state.session = { status: 'authenticated', role: 'customer' };
  h.queue.sessionChanged();
  assert.deepEqual(h.opened.map((o) => o.p.linkPath), ['/second']);
  const h2 = harness({ status: 'loading' });
  h2.queue.push({ linkPath: '/x' });
  h2.queue.dispose();
  h2.state.session = { status: 'authenticated', role: 'customer' };
  h2.queue.sessionChanged();
  assert.equal(h2.opened.length, 0);
}
console.log('notificationNavigation: ok');
