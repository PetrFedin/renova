import assert from 'node:assert/strict';
import { mergeFieldChoices } from './fieldDiff';

const local = JSON.stringify({ title: 'Мой', qty: 3 });
const server = JSON.stringify({ title: 'Серверный', qty: 3, note: 'x' });

// без серверной версии выбор «Сервер» не стирает поле
assert.equal(mergeFieldChoices(local, undefined, { title: 'server' }), local);
// по умолчанию остаётся локальное
assert.deepEqual(JSON.parse(mergeFieldChoices(local, server, {})), { title: 'Мой', qty: 3 });
// выбор сервера подставляет серверное значение
assert.equal(JSON.parse(mergeFieldChoices(local, server, { title: 'server' })).title, 'Серверный');
// поле, которого нет на сервере, при выборе сервера убирается (сервер — источник истины)
assert.equal('note' in JSON.parse(mergeFieldChoices(local, server, { note: 'server' })), true);
console.log('fieldDiff.test ok');
