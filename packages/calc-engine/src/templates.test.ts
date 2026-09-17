import { generateTemplateLines } from './templates';
import type { RoomMetrics } from './types';

const metrics: RoomMetrics = {
  floorSqM: 12,
  wallSqM: 38,
  perimeterM: 14,
  volumeCuM: 32.4,
};

const kitchen = generateTemplateLines('kitchen', 'kitchen-1', metrics, {
  outletsCount: 8,
  plumbingPoints: 3,
});

const electrical = kitchen.works.find((line) => line.id === 'kitchen-1-w-electrical');
if (!electrical) throw new Error('electrical work line missing');
if (electrical.quantity !== 8) throw new Error('electrical point quantity mismatch');
if (electrical.ratePerUnit !== 850) throw new Error('electrical point rate mismatch');
if (electrical.unit !== 'point') throw new Error('electrical point unit mismatch');

const plumbing = kitchen.works.find((line) => line.id === 'kitchen-1-w-plumbing');
if (!plumbing) throw new Error('plumbing work line missing');
if (plumbing.quantity !== 3) throw new Error('plumbing point quantity mismatch');
if (plumbing.ratePerUnit !== 2500) throw new Error('plumbing point rate mismatch');
if (plumbing.unit !== 'point') throw new Error('plumbing point unit mismatch');

const withoutEngineering = generateTemplateLines('kitchen', 'kitchen-2', metrics);
if (withoutEngineering.works.some((line) => line.unit === 'point')) {
  throw new Error('zero engineering counts must not create work lines');
}

for (const invalidCount of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
  let rejected = false;
  try {
    generateTemplateLines('cosmetic', 'invalid-room', metrics, { outletsCount: invalidCount });
  } catch (error) {
    rejected = error instanceof RangeError;
  }
  if (!rejected) throw new Error(`invalid engineering count accepted: ${String(invalidCount)}`);
}

console.log('calc-engine/templates.test OK');
