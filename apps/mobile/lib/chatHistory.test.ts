import assert from 'node:assert/strict';
import { canLoadEarlier, CHAT_MAX_WINDOW, CHAT_PAGE_SIZE, prependEarlier, reloadWindowSize } from './chatHistory';

const m = (i: number) => ({ id: `m${String(i).padStart(3, '0')}`, created_at: `2026-01-01T10:${String(i % 60).padStart(2, '0')}:00` });

assert.equal(reloadWindowSize(0), CHAT_PAGE_SIZE);
assert.equal(reloadWindowSize(30), CHAT_PAGE_SIZE);
assert.equal(reloadWindowSize(120), 120);
assert.equal(reloadWindowSize(5000), CHAT_MAX_WINDOW);

const current = [m(10), m(11), m(12)];
const merged = prependEarlier(current, [m(8), m(9), m(10)]);
assert.deepEqual(merged.map((x) => x.id), ['m008', 'm009', 'm010', 'm011', 'm012']);
assert.deepEqual(prependEarlier(current, []).map((x) => x.id), ['m010', 'm011', 'm012']);

// одинаковое время — порядок по id
const tie = prependEarlier([{ id: 'b', created_at: 't' }], [{ id: 'a', created_at: 't' }]);
assert.deepEqual(tie.map((x) => x.id), ['a', 'b']);

assert.equal(canLoadEarlier(true, current), true);
assert.equal(canLoadEarlier(false, current), false);
assert.equal(canLoadEarlier(undefined, current), false);
assert.equal(canLoadEarlier(true, []), false);
console.log('chatHistory ok');
