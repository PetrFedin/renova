import assert from 'node:assert/strict';
import {
  beginSessionAuthority,
  captureSessionAuthority,
  currentSessionIdForUser,
  invalidateSessionAuthority,
  isCurrentSessionOwner,
  isSessionAuthorityCurrent,
  restoreSessionAuthority,
} from './sessionAuthority';

invalidateSessionAuthority();

const a1 = beginSessionAuthority('user-a');
assert.equal(isSessionAuthorityCurrent(a1), true);
assert.equal(currentSessionIdForUser('user-a'), a1.sessionId);
assert.equal(isCurrentSessionOwner('user-a', a1.sessionId), true);

const b = beginSessionAuthority('user-b');
assert.equal(isSessionAuthorityCurrent(a1), false, 'A response must be stale after login B');
assert.equal(isSessionAuthorityCurrent(b), true);
assert.equal(isCurrentSessionOwner('user-a', a1.sessionId), false);

const a2 = beginSessionAuthority('user-a');
assert.equal(isSessionAuthorityCurrent(b), false);
assert.equal(isSessionAuthorityCurrent(a2), true);
assert.notEqual(a2.sessionId, a1.sessionId, 'A -> B -> A must be a new logical login');
assert.ok(a2.generation > a1.generation);

const persisted = a2.sessionId!;
const restored = restoreSessionAuthority('user-a', persisted);
assert.equal(restored.sessionId, persisted, 'cold restart may restore the same persisted logical login id');
assert.equal(isSessionAuthorityCurrent(a2), false, 'restoration still fences in-process work from the prior generation');
assert.equal(isSessionAuthorityCurrent(restored), true);

const beforeLogout = captureSessionAuthority();
const loggedOut = invalidateSessionAuthority();
assert.equal(isSessionAuthorityCurrent(beforeLogout), false);
assert.equal(loggedOut.userId, null);
assert.equal(loggedOut.sessionId, null);
assert.equal(currentSessionIdForUser('user-a'), null);
assert.equal(isCurrentSessionOwner('user-a', persisted), false);

console.log('sessionAuthority.test OK');
