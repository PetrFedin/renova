import assert from 'node:assert/strict';
import { groupEstimateLinesByRoom } from './groupEstimateByRoom';
import type { EstimateLine } from '../api';

const line = (id: string, room: string | null, price: number): EstimateLine => ({
  id,
  line_type: 'material',
  name: id,
  unit: 'шт',
  quantity_planned: 1,
  quantity_actual: 1,
  unit_price: price,
  room_name: room,
  total: price,
});

const groups = groupEstimateLinesByRoom([
  line('a', 'Кухня', 100),
  line('b', 'Кухня', 50),
  line('c', null, 30),
]);
assert.equal(groups.length, 2);
assert.equal(groups.find((g) => g.roomLabel === 'Кухня')?.lines.length, 2);
assert.equal(groups.find((g) => g.roomLabel === 'Общее')?.plannedTotal, 30);

console.log('groupEstimateByRoom.test OK');
