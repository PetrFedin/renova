import assert from 'node:assert/strict';
import { resolveStageForRoom } from './stageResolve';

const stages = [
  { id: 's1', name: 'Демонтаж', status: 'done', room_ids: ['r1'] },
  { id: 's2', name: 'Сантехника', status: 'active', room_ids: ['r2', 'r3'] },
  { id: 's3', name: 'Отделка', status: 'planned', room_ids: ['r1'] },
] as any[];

assert.equal(resolveStageForRoom(stages, 'r2'), 's2');
assert.equal(resolveStageForRoom(stages, 'r1'), 's3'); // active/review first: s1 done, s3 planned beats done? 
// r1: s1 done has r1, s3 planned has r1 - active first: neither active/review for r1... s1 is done, s3 planned
// PRIORITY: active=0, review=1, planned=2, done=3
// sorted: s2(active), s3(planned), s1(done)
// r1: s2 no, s3 yes -> s3
assert.equal(resolveStageForRoom(stages, 'r1', 's1'), 's1');
assert.equal(resolveStageForRoom(stages, null), null);
console.log('stageResolve.test OK');
