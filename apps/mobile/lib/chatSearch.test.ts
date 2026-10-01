import assert from 'node:assert/strict';
import { hitsForThread, jumpPlan, parseChatSearchHits } from './chatSearch';

const parsed = parseChatSearchHits([
  { id: 'm1', thread_id: 't1', thread_title: 'Кухня', author_role: 'customer', text: 'скидка', created_at: '2026-01-01T10:00:00' },
  { thread_id: 't1', text: 'старый формат без id' },
  { id: 'm2', thread_id: 't2', text: null },
  null,
  'x',
]);
assert.deepEqual(parsed.map((h) => h.id), ['m1', 'm2']);
assert.equal(parsed[0].thread_title, 'Кухня');
assert.equal(parsed[1].text, '');
assert.deepEqual(parseChatSearchHits(undefined), []);
assert.deepEqual(parseChatSearchHits({ id: 'x' }), []);

const hits = [...parsed, { ...parsed[0] }];
assert.deepEqual(hitsForThread(hits, 't1').map((h) => h.id), ['m1']);
assert.deepEqual(hitsForThread(hits, 't3'), []);

assert.equal(jumpPlan(['a', 'b'], 'b'), 'scroll');
assert.equal(jumpPlan(['a', 'b'], 'zzz'), 'load_around');
console.log('chatSearch ok');
