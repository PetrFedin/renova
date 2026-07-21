/**
 * Russian pluralization.
 * Run: npx tsx apps/mobile/lib/i18n/ruPlural.test.ts
 */
import {
  formatBadgeCount,
  formatCompactCount,
  formatCount,
  normalizeCount,
  pluralCategoryRu,
  pluralizeRu,
} from './ruPlural';
import {
  formatDays,
  formatDocuments,
  formatFiles,
  formatInvoices,
  formatIssues,
  formatParticipants,
  formatPayments,
  formatPaymentsDue,
  formatProjects,
  formatRooms,
  formatTasks,
  formatUnreadCount,
  formatUnreadMessages,
  RU_NOUN,
} from './ruCountLabels';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const CASES = [
  0, 1, 2, 3, 4, 5, 10, 11, 12, 14,
  20, 21, 22, 25,
  100, 101, 102, 105, 111, 112, 121,
  -1, -2, 1.5, NaN,
] as const;

// Категории (cardinal ru)
const expectCat: Record<string, string> = {
  '0': 'many',
  '1': 'one',
  '2': 'few',
  '3': 'few',
  '4': 'few',
  '5': 'many',
  '10': 'many',
  '11': 'many',
  '12': 'many',
  '14': 'many',
  '20': 'many',
  '21': 'one',
  '22': 'few',
  '25': 'many',
  '100': 'many',
  '101': 'one',
  '102': 'few',
  '105': 'many',
  '111': 'many',
  '112': 'many',
  '121': 'one',
  '-1': 'one',
  '-2': 'few',
};

for (const n of CASES) {
  if (Number.isNaN(n)) {
    assert(normalizeCount(n) === 0, 'NaN → 0');
    assert(pluralCategoryRu(n) === 'many' || pluralCategoryRu(n) === 'other', 'NaN cat');
    continue;
  }
  const key = String(n);
  if (expectCat[key]) {
    assert(pluralCategoryRu(n) === expectCat[key], `cat ${n} → ${pluralCategoryRu(n)}`);
  }
}

// formatCount + задача
assert(formatCount(1, RU_NOUN.task) === '1 задача', '1 задача');
assert(formatCount(2, RU_NOUN.task) === '2 задачи', '2 задачи');
assert(formatCount(4, RU_NOUN.task) === '4 задачи', '4 задачи');
assert(formatCount(5, RU_NOUN.task) === '5 задач', '5 задач');
assert(formatCount(11, RU_NOUN.task) === '11 задач', '11 задач');
assert(formatCount(21, RU_NOUN.task) === '21 задача', '21 задача');
assert(formatCount(22, RU_NOUN.task) === '22 задачи', '22 задачи');
assert(formatCount(111, RU_NOUN.task) === '111 задач', '111 задач');

// сообщения / unread
assert(formatUnreadMessages(1).includes('сообщение'), '1 msg');
assert(formatUnreadMessages(2).includes('сообщения'), '2 msg');
assert(formatUnreadMessages(5).includes('сообщений'), '5 msg');
assert(formatUnreadMessages(11).includes('сообщений'), '11 msg');
assert(formatUnreadCount(1) === '1 непрочитанное', '1 unread');
assert(formatUnreadCount(11) === '11 непрочитанных', '11 unread');
assert(formatUnreadCount(21) === '21 непрочитанное', '21 unread');

// сущности
assert(formatDocuments(1) === '1 документ', 'doc1');
assert(formatDocuments(11) === '11 документов', 'doc11');
assert(formatIssues(3) === '3 замечания', 'issue3');
assert(formatIssues(12) === '12 замечаний', 'issue12');
assert(formatPayments(1) === '1 платёж', 'pay1');
assert(formatPayments(2) === '2 платежа', 'pay2');
assert(formatPaymentsDue(1) === '1 оплата', 'due1');
assert(formatPaymentsDue(11) === '11 оплат', 'due11');
assert(formatPaymentsDue(21) === '21 оплата', 'due21');
assert(formatInvoices(1) === '1 счёт', 'inv1');
assert(formatInvoices(11) === '11 счетов', 'inv11');
assert(formatInvoices(22) === '22 счёта', 'inv22');
assert(formatRooms(1) === '1 комната', 'room1');
assert(formatRooms(4) === '4 комнаты', 'room4');
assert(formatRooms(11) === '11 комнат', 'room11');
assert(formatDays(1) === '1 день', 'day1');
assert(formatDays(11) === '11 дней', 'day11');
assert(formatFiles(4) === '4 файла', 'file4');
assert(formatFiles(5) === '5 файлов', 'file5');
assert(formatParticipants(21) === '21 участник', 'part21');
assert(formatProjects(2) === '2 объекта', 'proj2');
assert(formatProjects(11) === '11 объектов', 'proj11');
assert(formatTasks(0) === '0 задач', '0 tasks');

// отрицательные / дробные / badge
assert(formatCount(-1, RU_NOUN.task) === '-1 задача', 'neg1');
assert(formatCount(-2, RU_NOUN.task) === '-2 задачи', 'neg2');
assert(pluralizeRu(1.5, RU_NOUN.task).length > 0, 'frac form');
assert(formatCompactCount(NaN) === '0', 'compact nan');
assert(formatCompactCount(-2) === '-2', 'compact -2');
assert(formatCompactCount(1.5) === '1.5', 'compact 1.5');
assert(formatBadgeCount(0) === '', 'badge 0');
assert(formatBadgeCount(1) === '1', 'badge 1');
assert(formatBadgeCount(99) === '99', 'badge 99');
assert(formatBadgeCount(100) === '99+', 'badge 100');
assert(formatBadgeCount(121) === '99+', 'badge 121');
assert(formatBadgeCount(NaN) === '', 'badge nan');

console.log('ruPlural.test OK');
