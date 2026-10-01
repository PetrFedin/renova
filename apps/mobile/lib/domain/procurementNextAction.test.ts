import { pickIdsNeedingPrice, procurementNextAction, readyPickIds } from './procurementNextAction';

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

// EST-011: позиция с непроверенной ценой не попадает в «готовые» (сервер отклонил бы всю пачку)
const mixed = [
  { id: 'ok', status: 'approved', qty: 1, supply_source: 'contractor_to_buy' as const, price_actionable: true },
  { id: 'bad', status: 'approved', qty: 1, supply_source: 'contractor_to_buy' as const, price_actionable: false },
];
if (readyPickIds(mixed, [], 'contractor').join(',') !== 'ok') throw new Error('unverified price must not be ready');
if (pickIdsNeedingPrice(mixed, [], 'contractor').join(',') !== 'bad') throw new Error('needs price list');
const onlyBad = procurementNextAction([mixed[1]], [], [{ verified: true }], 'contractor');
if (onlyBad.id !== 'confirm_price') throw new Error(`expected confirm_price, got ${onlyBad.id}`);
// старый ответ без поля price_actionable не ломает цепочку
if (readyPickIds([{ id: 'x', status: 'approved', qty: 1, supply_source: 'contractor_to_buy' }], [], 'contractor').join(',') !== 'x') throw new Error('legacy payload');

console.log('procurementNextAction.test OK');
