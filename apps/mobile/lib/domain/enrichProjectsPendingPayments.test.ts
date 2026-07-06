import { applyPendingPaymentCounts } from './enrichProjectsPendingPayments';

const base = {
  id: 'a',
  name: 'A',
  address: null,
  renovation_type: 'cosmetic',
  budget_planned: 100,
  budget_spent: 50,
  rooms_count: 2,
  stages_count: 5,
  progress_percent: 100,
} as any;

const out = applyPendingPaymentCounts(
  [
    { ...base, id: 'b', progress_percent: 50 },
    { ...base, id: 'a' },
    { ...base, id: 'c', pending_payments: 5 },
  ],
  { a: 2 },
);

if (out.find((p) => p.id === 'a')?.pending_payments !== 2) throw new Error('enriched a');
if (out.find((p) => p.id === 'b')?.pending_payments != null) throw new Error('skip active without count');
if (out.find((p) => p.id === 'c')?.pending_payments !== 5) throw new Error('keep backend value');

console.log('enrichProjectsPendingPayments.test OK');
