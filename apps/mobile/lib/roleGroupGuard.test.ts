import assert from 'node:assert/strict';
import { carryParams, decideRoleGroupAccess, sharedTabSegment } from './roleGroupGuard';

assert.deepEqual(decideRoleGroupAccess('customer', { loading: true, hasUser: false }), { kind: 'wait' });
assert.deepEqual(decideRoleGroupAccess('customer', { loading: false, hasUser: false }), { kind: 'login' });
assert.deepEqual(decideRoleGroupAccess('customer', { loading: false, hasUser: true, userRole: 'customer' }), { kind: 'allow' });
assert.deepEqual(decideRoleGroupAccess('contractor', { loading: false, hasUser: true, userRole: 'contractor' }), { kind: 'allow' });
assert.deepEqual(decideRoleGroupAccess('contractor', { loading: false, hasUser: true, userRole: 'customer' }), { kind: 'redirect', to: 'customer' });
assert.deepEqual(decideRoleGroupAccess('customer', { loading: false, hasUser: true, userRole: 'contractor' }), { kind: 'redirect', to: 'contractor' });

// Холодная глубокая ссылка: URL одинаков для обеих групп, редирект сохраняет вкладку.
assert.equal(sharedTabSegment('/profile'), 'profile');
assert.equal(sharedTabSegment('/object'), 'object');
assert.equal(sharedTabSegment('/(contractor)/(tabs)/repair'), 'repair');
assert.equal(sharedTabSegment('/'), 'index');
assert.equal(sharedTabSegment('/job-leads'), 'index');
assert.equal(sharedTabSegment('/object/extra'), 'index');
assert.deepEqual(carryParams({ tab: 'estimate', subtab: ['a', 'b'], screen: 'x', empty: '' }), { tab: 'estimate', subtab: 'a' });

console.log('roleGroupGuard.test OK');
