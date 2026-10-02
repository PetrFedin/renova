import { isIsoDate, isoToRuDate, maskRuDateInput, normalizeIsoDateInput } from './validateDate';

if (!isIsoDate('2026-06-28')) throw new Error('valid date');
if (isIsoDate('2026-13-01')) throw new Error('invalid month');
if (normalizeIsoDateInput('2026-06-28abc') !== '2026-06-28') throw new Error('normalize');

if (isoToRuDate('2026-06-28') !== '28.06.2026') throw new Error('isoToRu');
if (isoToRuDate('28.0') !== '28.0') throw new Error('isoToRu passthrough');
if (maskRuDateInput('28062026') !== '28.06.2026') throw new Error('mask full');
if (maskRuDateInput('2806') !== '28.06') throw new Error('mask partial');
if (maskRuDateInput('28.06.20269999') !== '28.06.2026') throw new Error('mask cap');
if (maskRuDateInput('2026-06-28') !== '2026-06-28') throw new Error('mask keeps iso');
if (parseDateInput(maskRuDateInput('01092026')) !== '2026-09-01') throw new Error('mask → parse');

console.log('validateDate.test OK');

import { checkDateRange, checkOptionalDate, parseDateInput } from './validateDate';
{
  const must = (c: boolean, m: string) => { if (!c) throw new Error(m); };
  must(parseDateInput('28.06.2026') === '2026-06-28', 'dd.mm.yyyy');
  must(parseDateInput('1.2.2026') === '2026-02-01', 'короткие день/месяц');
  must(parseDateInput('2026-06-28') === '2026-06-28', 'iso');
  must(parseDateInput('31.02.2026') === null, 'несуществующий день');
  must(parseDateInput('завтра') === null, 'мусор');
  must(checkOptionalDate('  ', 'Начало').ok === true, 'пусто допустимо');
  must(checkOptionalDate('32.01.2026', 'Начало').ok === false, 'невалидная');
  const ok = checkDateRange('01.07.2026', '2026-07-10');
  must(ok.ok && ok.start === '2026-07-01' && ok.end === '2026-07-10', 'диапазон ok');
  must(checkDateRange('10.07.2026', '01.07.2026').ok === false, 'конец раньше начала');
  must(checkDateRange('', '01.07.2026').ok === true, 'только конец');
  console.log('validateDate extended OK');
}

import { parseDateTimeInput } from './validateDate';
{
  if (parseDateTimeInput('2026-07-01T09:00') !== '2026-07-01T09:00:00') throw new Error('iso dt');
  if (parseDateTimeInput('01.07.2026 9:30') !== '2026-07-01T09:30:00') throw new Error('ru dt');
  if (parseDateTimeInput('2026-07-01 25:00') !== null) throw new Error('час');
  if (parseDateTimeInput('2026-07-01') !== null) throw new Error('без времени');
  console.log('parseDateTimeInput OK');
}
