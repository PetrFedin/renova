import { procurementNextAction, readyPickIds } from './procurementNextAction';

const ready = readyPickIds(
  [
    { id: 'a', status: 'approved', qty: 1, supply_source: 'contractor_to_buy' },
    { id: 'b', status: 'draft', qty: 1, supply_source: 'contractor_to_buy' },
    { id: 'c', status: 'approved', qty: 1, supply_source: 'contractor_to_buy' },
  ],
  [{ id: 'p1', status: 'ordered', items: [{ material_pick_id: 'c' }] }],
  'contractor',
);
if (ready.join(',') !== 'a') throw new Error(`ready expected a, got ${ready}`);

const gen = procurementNextAction([], [], [], 'contractor');
if (gen.id !== 'generate') throw new Error('generate');

const create = procurementNextAction(
  [{ id: 'a', status: 'approved', qty: 1, supply_source: 'contractor_to_buy' }],
  [],
  [],
  'contractor',
);
if (create.id !== 'create_purchase') throw new Error('create_purchase');

const adv = procurementNextAction(
  [{ id: 'a', status: 'approved', qty: 1, supply_source: 'contractor_to_buy' }],
  [{ id: 'p', status: 'ordered', items: [{ material_pick_id: 'a' }] }],
  [],
  'contractor',
);
if (adv.id !== 'advance_purchase') throw new Error('advance');

console.log('procurementNextAction.test OK');
