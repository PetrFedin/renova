import { progressFromStages, resolveProjectProgress } from './resolveProjectProgress';

const stages = [
  { id: '1', status: 'done' },
  { id: '2', status: 'done' },
] as any[];

if (resolveProjectProgress(stages, 0, null) !== 100) throw new Error('complete stages => 100%');
if (resolveProjectProgress([], 42, null) !== 42) throw new Error('fallback dash');
if (progressFromStages([{ status: 'done' }, { status: 'active' }] as any) !== 50) throw new Error('half done');
console.log('resolveProjectProgress.test OK');
