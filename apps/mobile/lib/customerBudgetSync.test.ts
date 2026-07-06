import assert from 'node:assert/strict';
import { normalizeCustomerBudget, resolveCustomerBudget } from './customerBudgetSync';

assert.equal(normalizeCustomerBudget(500000), 500000);
assert.equal(normalizeCustomerBudget(0), null);
assert.equal(normalizeCustomerBudget(null), null);
assert.equal(resolveCustomerBudget(800000, 500000), 800000);
assert.equal(resolveCustomerBudget(null, 500000), 500000);
assert.equal(resolveCustomerBudget(undefined, null), null);

console.log('customerBudgetSync.test OK');
