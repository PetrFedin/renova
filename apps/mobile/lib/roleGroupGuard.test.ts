import assert from 'node:assert/strict';
import { decideRoleGroupAccess } from './roleGroupGuard';

assert.deepEqual(decideRoleGroupAccess('customer', { loading: true, hasUser: false }), { kind: 'wait' });
assert.deepEqual(decideRoleGroupAccess('customer', { loading: false, hasUser: false }), { kind: 'login' });
assert.deepEqual(decideRoleGroupAccess('customer', { loading: false, hasUser: true, userRole: 'customer' }), { kind: 'allow' });
assert.deepEqual(decideRoleGroupAccess('contractor', { loading: false, hasUser: true, userRole: 'contractor' }), { kind: 'allow' });
assert.deepEqual(decideRoleGroupAccess('contractor', { loading: false, hasUser: true, userRole: 'customer' }), { kind: 'redirect', to: 'customer' });
assert.deepEqual(decideRoleGroupAccess('customer', { loading: false, hasUser: true, userRole: 'contractor' }), { kind: 'redirect', to: 'contractor' });

console.log('roleGroupGuard.test OK');
