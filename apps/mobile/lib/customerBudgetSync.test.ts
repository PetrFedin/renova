import assert from 'node:assert/strict';
import {
  normalizeCustomerBudget,
  parseCustomerBudgetInput,
  resolveCustomerBudget,
} from './customerBudgetSync';

assert.equal(normalizeCustomerBudget(500000), 500000);
assert.equal(normalizeCustomerBudget(0), null);
assert.equal(normalizeCustomerBudget(null), null);
assert.equal(resolveCustomerBudget(800000, 500000), 800000);
assert.equal(resolveCustomerBudget(null, 500000), 500000);
assert.equal(resolveCustomerBudget(undefined, null), null);

assert.deepEqual(parseCustomerBudgetInput('500000'), { value: 500000, error: null });
assert.deepEqual(parseCustomerBudgetInput('500 000'), { value: 500000, error: null });
assert.deepEqual(parseCustomerBudgetInput(''), { value: null, error: null });
assert.deepEqual(parseCustomerBudgetInput('   '), { value: null, error: null });
assert.equal(parseCustomerBudgetInput('0').value, null);
assert.ok(parseCustomerBudgetInput('0').error);
assert.ok(parseCustomerBudgetInput('-10').error);
assert.ok(parseCustomerBudgetInput('100abc').error);
assert.ok(parseCustomerBudgetInput('9007199254740992').error);

console.log('customerBudgetSync.test OK');
