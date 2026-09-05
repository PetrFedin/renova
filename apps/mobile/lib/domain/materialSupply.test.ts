import assert from 'node:assert/strict';

import { procurementNextAction, readyPickIds } from './procurementNextAction';
import {
  needsAvailabilityUpdate,
  quantityToBuy,
  roleOwnsPurchase,
  totalAvailableQty,
} from './materialSupply';

const own = {
  id: 'own',
  status: 'approved',
  qty: 5,
  qty_available: 5,
  qty_delivered: 0,
  supply_source: 'customer_on_hand' as const,
};
const customerBuy = {
  id: 'customer-buy',
  status: 'approved',
  qty: 10,
  qty_available: 3,
  qty_delivered: 0,
  supply_source: 'customer_to_buy' as const,
};
const contractorBuy = {
  id: 'contractor-buy',
  status: 'approved',
  qty: 8,
  qty_available: 2,
  qty_delivered: 1,
  supply_source: 'contractor_to_buy' as const,
};
const includedMissing = {
  id: 'included-missing',
  status: 'approved',
  qty: 4,
  qty_available: 2,
  qty_delivered: 0,
  supply_source: 'contractor_included' as const,
};

assert.equal(quantityToBuy(own), 0);
assert.equal(quantityToBuy(customerBuy), 7);
assert.equal(quantityToBuy(contractorBuy), 5);
assert.equal(totalAvailableQty(contractorBuy), 3);
assert.equal(needsAvailabilityUpdate(includedMissing), true);
assert.equal(roleOwnsPurchase('customer_to_buy', 'customer'), true);
assert.equal(roleOwnsPurchase('customer_to_buy', 'contractor'), false);
assert.equal(roleOwnsPurchase('contractor_to_buy', 'contractor'), true);
assert.equal(roleOwnsPurchase('contractor_included', 'contractor'), false);

assert.deepEqual(
  readyPickIds([own, customerBuy, contractorBuy, includedMissing], [], 'customer'),
  ['customer-buy'],
);
assert.deepEqual(
  readyPickIds([own, customerBuy, contractorBuy, includedMissing], [], 'contractor'),
  ['contractor-buy'],
);
assert.deepEqual(
  readyPickIds(
    [customerBuy],
    [{ id: 'p1', status: 'ordered', items: [{ material_pick_id: 'customer-buy' }] }],
    'customer',
  ),
  [],
);
assert.deepEqual(
  readyPickIds(
    [customerBuy],
    [{ id: 'p1', status: 'returned', items: [{ material_pick_id: 'customer-buy' }] }],
    'customer',
  ),
  ['customer-buy'],
);

const customerNext = procurementNextAction(
  [own, customerBuy, contractorBuy],
  [],
  [],
  'customer',
);
assert.equal(customerNext.id, 'create_purchase');
assert.match(customerNext.title, /1 поз/);

const contractorNext = procurementNextAction(
  [own, customerBuy, contractorBuy],
  [],
  [],
  'contractor',
);
assert.equal(contractorNext.id, 'create_purchase');
assert.match(contractorNext.title, /1 поз/);

const externalNext = procurementNextAction([includedMissing], [], [], 'contractor');
assert.equal(externalNext.id, 'confirm_supply');

console.log('materialSupply domain tests passed');
