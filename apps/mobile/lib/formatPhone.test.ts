import assert from 'node:assert/strict';
import { normalizePhoneInput } from './formatPhone';
import { canEditProjectProfile, homeHeroLabel, roleScopeLabel } from './domain/roleCapabilities';

assert.equal(normalizePhoneInput('9001234567'), '+79001234567');
assert.equal(normalizePhoneInput('+7 900 123 45 67'), '+79001234567');
assert.equal(canEditProjectProfile({ role: 'contractor', readOnly: false }), false);
assert.equal(canEditProjectProfile({ role: 'customer', readOnly: false }), true);
assert.equal(homeHeroLabel({ role: 'contractor' }), 'Очередь дел');
assert.equal(homeHeroLabel({ role: 'customer' }), 'Очередь дел');
assert.match(roleScopeLabel({ role: 'customer' }), /Заказчик/);

console.log('formatPhone.test OK');
console.log('roleCapabilities.test OK');
