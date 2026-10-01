import assert from 'node:assert/strict';
import { authorLabel, authorRoleLabel, isMineMessage } from './chatMessageAuthor';

const me = { id: 'u1', role: 'contractor' };
assert.equal(isMineMessage({ author_id: 'u1', author_role: 'contractor' }, me), true);
// второй член команды той же роли — НЕ «моё»
assert.equal(isMineMessage({ author_id: 'u2', author_role: 'contractor' }, me), false);
assert.equal(isMineMessage({ author_id: 'u1', author_role: 'customer' }, me), true);
// без author_id — запасной путь по роли
assert.equal(isMineMessage({ author_role: 'contractor' }, me), true);
assert.equal(isMineMessage({ author_role: 'customer' }, me), false);
assert.equal(isMineMessage({ author_id: null, author_role: null }, me), false);

assert.equal(authorRoleLabel('supervisor'), 'Технадзор');
assert.equal(authorRoleLabel('system'), 'Система');
assert.equal(authorLabel({ author_name: 'Иван', author_role: 'contractor' }, false), 'Иван · Исполнитель');
assert.equal(authorLabel({ author_name: '  ', author_role: 'customer' }, false), 'Заказчик');
assert.equal(authorLabel({ author_name: 'Иван', author_role: 'contractor' }, true), 'Вы');
console.log('chatMessageAuthor ok');
