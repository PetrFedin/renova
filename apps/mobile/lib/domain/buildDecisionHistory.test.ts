import {
  buildDecisionHistory,
  classifyDecision,
  filterDecisionHistory,
} from './buildDecisionHistory';
import type { ActivityItem } from '../api';

const base = (over: Partial<ActivityItem>): ActivityItem => ({
  id: '1',
  kind: 'approval',
  title: 'Test',
  at: '2026-06-01T10:00:00',
  ...over,
});

if (classifyDecision(base({ kind: 'approval', title: 'Доп. работы одобрены' })) !== 'approval') {
  throw new Error('approval classify');
}
if (classifyDecision(base({ kind: 'schedule', title: 'Срок этапа перенесён' })) !== 'schedule') {
  throw new Error('schedule classify');
}
if (classifyDecision(base({ kind: 'material', title: 'Плитка закуплена' })) !== null) {
  throw new Error('material skip');
}

const stageItems = buildDecisionHistory(
  [
    base({ id: 'a', title: 'Смета изменена', kind: 'estimate', link_path: '/stage/st-1' }),
    base({ id: 'b', title: 'Срок перенесён', kind: 'schedule', link_path: '/stage/st-2' }),
  ],
  { stageId: 'st-1' },
);
if (stageItems.length !== 1 || stageItems[0].id !== 'a') throw new Error('stage filter');

const all = buildDecisionHistory([
  base({ id: 'a', title: 'Одобрено', kind: 'approval' }),
  base({ id: 'b', title: 'Срок перенесён', kind: 'schedule' }),
]);
if (filterDecisionHistory(all, 'approval').length !== 1) throw new Error('category filter');

console.log('buildDecisionHistory.test OK');
