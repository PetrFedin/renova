import { buildHomeMoreSummary, formatRiskCount, homeMoreHasVisibleContent } from './buildHomeMoreSummary';

const snap = {
  isComplete: true,
  pendingPayments: 0,
  risks: [{ id: '1' }, { id: '2' }],
  activeWorks: [],
  materialNeeds: [],
} as any;

const project = { property_type: 'house', rooms: [{ id: '1' }] } as any;
const isVisible = (id: string) => ['risks', 'activity', 'documents'].includes(id);

const summary = buildHomeMoreSummary({
  snap,
  project,
  budgetAlerts: [],
  receipts: [],
  picks: [],
  isVisible: isVisible as any,
});

if (!summary.includes('2 риска') || !summary.includes('документы')) throw new Error('more summary');
if (formatRiskCount(1) !== '1 риск') throw new Error('risk 1');
if (formatRiskCount(3) !== '3 риска') throw new Error('risk 3');
if (formatRiskCount(5) !== '5 рисков') throw new Error('risk 5');

if (!homeMoreHasVisibleContent({
  snap,
  project,
  budgetAlerts: [],
  receipts: [],
  picks: [],
  isVisible: isVisible as any,
})) throw new Error('visible content');

if (homeMoreHasVisibleContent({
  snap: { ...snap, isComplete: false, pendingPayments: 0, risks: [] },
  project,
  budgetAlerts: [],
  receipts: [],
  picks: [],
  isVisible: () => false,
})) throw new Error('empty should be false');

console.log('buildHomeMoreSummary.test OK');
