import {
  dueDateLabel,
  dueDateState,
  formatDueDate,
  parseDueDateInput,
  sortPaymentsByDue,
} from './paymentDueDate';

const now = new Date('2026-10-01T10:00:00Z');

const full = parseDueDateInput('05.10.2026', now);
if (!full.ok || !full.iso?.startsWith('2026-10-05T23:59')) throw new Error('полная дата');

const short = parseDueDateInput('05.10', now);
if (!short.ok || !short.iso?.startsWith('2026-10-05')) throw new Error('дата без года');

const twoDigitYear = parseDueDateInput('05.10.27', now);
if (!twoDigitYear.ok || !twoDigitYear.iso?.startsWith('2027-10-05')) throw new Error('двузначный год');

const empty = parseDueDateInput('   ', now);
if (!empty.ok || empty.iso !== null) throw new Error('пустая строка — это «без срока»');

const garbage = parseDueDateInput('завтра', now);
if (garbage.ok) throw new Error('мусор должен отклоняться');

const impossible = parseDueDateInput('31.02.2026', now);
if (impossible.ok) throw new Error('31 февраля не существует');

if (dueDateState(null, now) !== null) throw new Error('без срока состояния нет');
if (dueDateState('2026-09-30T23:59:00Z', now) !== 'overdue') throw new Error('просрочка');
if (dueDateState('2026-10-01T23:59:00Z', now) !== 'today') throw new Error('сегодня');
if (dueDateState('2026-10-03T23:59:00Z', now) !== 'soon') throw new Error('скоро');
if (dueDateState('2026-11-01T23:59:00Z', now) !== 'later') throw new Error('позже');
if (dueDateState('не дата', now) !== null) throw new Error('нераспознанная дата не состояние');

if (formatDueDate('2026-10-05T23:59:00Z') !== '05.10.2026') throw new Error('формат даты');
if (formatDueDate(null) !== '') throw new Error('пустой формат');
if (dueDateLabel('2026-09-30T23:59:00Z', now) !== 'Просрочен · до 30.09.2026') throw new Error('подпись просрочки');
if (dueDateLabel('2026-11-01T23:59:00Z', now) !== 'До 01.11.2026') throw new Error('подпись срока');
if (dueDateLabel(null, now) !== '') throw new Error('без срока подписи нет');

const rows = [
  { id: 'a', status: 'pending', created_at: '2026-09-01T10:00:00Z', due_at: null },
  { id: 'b', status: 'confirmed', created_at: '2026-09-20T10:00:00Z', due_at: null },
  { id: 'c', status: 'pending', created_at: '2026-09-02T10:00:00Z', due_at: '2026-10-10T23:59:00Z' },
  { id: 'd', status: 'pending', created_at: '2026-09-03T10:00:00Z', due_at: '2026-09-30T23:59:00Z' },
];
const order = sortPaymentsByDue(rows).map((row) => row.id).join(',');
if (order !== 'd,c,a,b') throw new Error(`очерёдность: ${order}`);
if (sortPaymentsByDue(rows) === rows) throw new Error('сортировка не должна мутировать вход');
if (rows.map((row) => row.id).join(',') !== 'a,b,c,d') throw new Error('исходный список изменён');

console.log('paymentDueDate.test OK');
