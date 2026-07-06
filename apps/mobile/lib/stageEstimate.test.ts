import { stagePlanFromEstimate, sumEstimateLines, filterLinesForStage } from './stageEstimate';

const lines = [
  { id: '1', line_type: 'work', name: 'Плитка', unit: 'm2', quantity_planned: 10, quantity_actual: 0, unit_price: 1000, room_name: 'Ванная', room_id: 'r1', total: 10000 },
  { id: '2', line_type: 'work', name: 'Краска', unit: 'm2', quantity_planned: 20, quantity_actual: 0, unit_price: 500, room_name: 'Гостиная', room_id: 'r2', total: 10000 },
] as any[];

const plan = stagePlanFromEstimate({ room_ids: ['r1'], payment_amount: 999 }, lines);
if (plan !== 10000) throw new Error('plan from estimate');
if (stagePlanFromEstimate({ room_ids: [], payment_amount: 5000 }, []) !== 5000) throw new Error('fallback payment_amount');
if (sumEstimateLines(filterLinesForStage(lines, ['r2'])) !== 10000) throw new Error('filter room');

console.log('stageEstimate.test OK');
