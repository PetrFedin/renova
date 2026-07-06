/** Форматирование дат календаря — одна строка, без переносов, ru-RU */

function parseIso(iso: string | null | undefined): Date | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return null;
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Компактно для списка событий: «28.06» */
export function formatScheduleDayShort(iso: string | null | undefined): string {
  const d = parseIso(iso);
  if (!d) return '—';
  const day = d.getDate();
  const month = d.getMonth() + 1;
  return `${String(day).padStart(2, '0')}.${String(month).padStart(2, '0')}`;
}

/** Полная дата: «28.06.2026» */
export function formatScheduleDayFull(iso: string | null | undefined): string {
  const d = parseIso(iso);
  if (!d) return '—';
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** Диапазон плана работ: «28.06.2026 — 27.08.2026» */
export function formatScheduleRange(
  start: string | null | undefined,
  end: string | null | undefined,
): string {
  const a = formatScheduleDayFull(start);
  const b = formatScheduleDayFull(end);
  if (a === '—' && b === '—') return 'Сроки не заданы';
  if (a === '—') return `до ${b}`;
  if (b === '—') return `с ${a}`;
  return `${a} — ${b}`;
}

/** Для карточки работы: «28.06 — 05.07» */
export function formatScheduleWorkSpan(
  start: string | null | undefined,
  end: string | null | undefined,
): string | null {
  if (!start && !end) return null;
  const a = formatScheduleDayShort(start);
  const b = formatScheduleDayShort(end);
  if (start && end && start.slice(0, 10) === end.slice(0, 10)) return a;
  if (start && end) return `${a} — ${b}`;
  return start ? `с ${a}` : `до ${b}`;
}
