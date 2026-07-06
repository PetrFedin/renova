import {
  formatProjectHeaderMeta,
  formatProjectPhaseSubtitle,
  isClosingPhaseSecondary,
  resolveProjectPhase,
} from './resolveProjectPhase';

const base = { isComplete: true, pendingPayments: 5, healthLevel: 'good' as const, healthLabel: 'Завершён' };

if (resolveProjectPhase(base) !== 'closing') throw new Error('closing phase');
if (resolveProjectPhase({ ...base, pendingPayments: 0 }) !== 'complete') throw new Error('complete phase');
if (resolveProjectPhase({ ...base, isComplete: false, pendingPayments: 0 }) !== 'active') throw new Error('active phase');

const sub = formatProjectPhaseSubtitle('house', 5, 'МО, д. Пример');
if (!sub.includes('Дом') || !sub.includes('5 комн') || !sub.includes('Пример')) throw new Error('subtitle object context');
if (sub.includes('Закрытие') || sub.includes('оплат')) throw new Error('subtitle must not duplicate KPI phase');

const meta = formatProjectHeaderMeta('house', 5, 'МО, д. Пример', {
  isComplete: true,
  pendingPayments: 5,
  pendingPaymentTotal: 315_143,
});
if (meta.context !== sub) throw new Error('header meta context');
if (meta.status) throw new Error('closing header must not repeat payment amount');

if (!isClosingPhaseSecondary('payment')) throw new Error('payment secondary');
if (isClosingPhaseSecondary('material')) throw new Error('material blocked in closing');

console.log('resolveProjectPhase.test OK');
