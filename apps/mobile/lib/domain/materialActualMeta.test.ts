/** Issue #379: quantity_actual === 0 is a measured zero, not "not entered" —
 * `l.quantity_actual || l.quantity_planned` silently displayed plan as fact. */
import assert from 'node:assert/strict';
import { materialActualMeta } from './materialActualMeta';
import type { EstimateLine } from '../api';

const line = (quantity_planned: number, quantity_actual: number, unit_price: number): EstimateLine => ({
  id: 'l1',
  line_type: 'material',
  name: 'x',
  unit: 'шт',
  quantity_planned,
  quantity_actual,
  unit_price,
  room_name: null,
  total: quantity_planned * unit_price,
});

// Explicit zero actual must render as "0", not fall back to plan.
assert.match(materialActualMeta(line(10, 0, 5)), /факт 0 шт/);
assert.doesNotMatch(materialActualMeta(line(10, 0, 5)), /факт 10 шт/);

// Positive actual is shown as-is, including overrun percent.
assert.match(materialActualMeta(line(10, 7, 5)), /факт 7 шт/);
assert.match(materialActualMeta(line(10, 20, 5)), /\+100%/);

console.log('materialActualMeta.test OK');
