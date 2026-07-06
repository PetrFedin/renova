import { formatProfileGapLabel, getProjectProfileGaps } from './projectProfileGaps';

const project = {
  address: null,
  planned_start_date: '2026-01-01',
  planned_end_date: null,
} as any;

const gaps = getProjectProfileGaps(project);
if (!gaps.includes('address') || !gaps.includes('dates')) throw new Error('gaps detect');
if (formatProfileGapLabel(gaps) !== 'адрес и сроки') throw new Error('gap label');
if (getProjectProfileGaps({ address: 'ул. Пример', planned_start_date: '2026-01-01', planned_end_date: '2026-06-01' } as any).length !== 0) {
  throw new Error('complete profile');
}

console.log('homePriority.test OK');
