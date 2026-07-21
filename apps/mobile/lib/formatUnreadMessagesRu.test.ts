import { formatBadgeCount, formatUnreadMessagesRu, pluralRu } from './formatUnreadMessagesRu';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(pluralRu(1, 'а', 'б', 'в') === 'а', '1');
assert(pluralRu(2, 'а', 'б', 'в') === 'б', '2');
assert(pluralRu(4, 'а', 'б', 'в') === 'б', '4');
assert(pluralRu(5, 'а', 'б', 'в') === 'в', '5');
assert(pluralRu(11, 'а', 'б', 'в') === 'в', '11');
assert(pluralRu(12, 'а', 'б', 'в') === 'в', '12');
assert(pluralRu(14, 'а', 'б', 'в') === 'в', '14');
assert(pluralRu(21, 'а', 'б', 'в') === 'а', '21');
assert(pluralRu(22, 'а', 'б', 'в') === 'б', '22');
assert(pluralRu(25, 'а', 'б', 'в') === 'в', '25');
assert(pluralRu(101, 'а', 'б', 'в') === 'а', '101');
assert(pluralRu(111, 'а', 'б', 'в') === 'в', '111');

assert(formatUnreadMessagesRu(1) === '1 непрочитанное сообщение', 'fmt 1');
assert(formatUnreadMessagesRu(2) === '2 непрочитанных сообщения', 'fmt 2');
assert(formatUnreadMessagesRu(5) === '5 непрочитанных сообщений', 'fmt 5');
assert(formatUnreadMessagesRu(11) === '11 непрочитанных сообщений', 'fmt 11');
assert(formatUnreadMessagesRu(21) === '21 непрочитанное сообщение', 'fmt 21');
assert(formatUnreadMessagesRu(22) === '22 непрочитанных сообщения', 'fmt 22');

assert(formatBadgeCount(0) === '', 'badge 0');
assert(formatBadgeCount(1) === '1', 'badge 1');
assert(formatBadgeCount(99) === '99', 'badge 99');
assert(formatBadgeCount(100) === '99+', 'badge 100');
assert(formatBadgeCount(999) === '99+', 'badge 999');

console.log('formatUnreadMessagesRu.test OK');
