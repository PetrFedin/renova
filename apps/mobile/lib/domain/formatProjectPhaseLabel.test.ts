import { formatProjectPhaseLabel } from './formatProjectPhaseLabel';

const base = {
  id: '1',
  name: 'Test',
  address: null,
  renovation_type: 'cosmetic',
  budget_planned: 100,
  budget_spent: 50,
  rooms_count: 2,
  stages_count: 5,
} as any;

if (formatProjectPhaseLabel({ ...base, progress_percent: 50 }) !== 'В работе') {
  throw new Error('active phase');
}
if (formatProjectPhaseLabel({ ...base, progress_percent: 100, pending_payments: 3 }) !== 'Закрытие · 3 оплат') {
  throw new Error('closing phase');
}
if (formatProjectPhaseLabel({ ...base, progress_percent: 100, pending_payments: 0 }) !== 'Завершён') {
  throw new Error('complete phase');
}

console.log('formatProjectPhaseLabel.test OK');
