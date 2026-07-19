import { procurementNextAction, readyPickIds } from './procurementNextAction';

const ready = readyPickIds(
  [
    { id: 'a', status: 'approved' },
    { id: 'b', status: 'draft' },
    { id: 'c', status: 'approved' },
  ],
  [{ id: 'p1', status: 'ordered', items: [{ material_pick_id: 'c' }] }],
);
if (ready.join(',') !== 'a') throw new Error(`ready expected a, got ${ready}`);

const gen = procurementNextAction([], [], []);
if (gen.id !== 'generate') throw new Error('generate');

const create = procurementNextAction([{ id: 'a', status: 'approved' }], [], []);
if (create.id !== 'create_purchase') throw new Error('create_purchase');

const adv = procurementNextAction(
  [{ id: 'a', status: 'approved' }],
  [{ id: 'p', status: 'ordered', items: [{ material_pick_id: 'a' }] }],
  [],
);
if (adv.id !== 'advance_purchase') throw new Error('advance');

console.log('procurementNextAction.test OK');
