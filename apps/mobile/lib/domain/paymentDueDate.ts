/**
 * Срок оплаты счёта: разбор ввода, состояние срока и очерёдность счетов.
 *
 * Отдельного поля «приоритет» нет намеренно: очерёдность целиком выводится
 * из срока, иначе два источника правды противоречили бы друг другу.
 */
import type { Payment } from '@/lib/api/types/budget';

export type DueState = 'overdue' | 'today' | 'soon' | 'later';

export type DueParseResult = { ok: true; iso: string | null } | { ok: false; message: string };

const DAY_MS = 86400000;
/** Срок — это весь день целиком, поэтому фиксируем конец суток по UTC. */
const END_OF_DAY_HOUR = 23;
const END_OF_DAY_MINUTE = 59;

function isRealDate(year: number, month: number, day: number): boolean {
  const probe = new Date(Date.UTC(year, month - 1, day));
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}

/**
 * Принимает «ДД.ММ.ГГГГ» и «ДД.ММ» (год берётся текущий). Пустая строка — это
 * осознанное «без срока», а не ошибка.
 */
export function parseDueDateInput(raw: string, now: Date = new Date()): DueParseResult {
  const text = raw.trim();
  if (!text) return { ok: true, iso: null };
  const match = /^(\d{1,2})[.\-/](\d{1,2})(?:[.\-/](\d{2}|\d{4}))?$/.exec(text);
  if (!match) return { ok: false, message: 'Дата в формате ДД.ММ.ГГГГ, например 05.10.2026' };
  const day = Number(match[1]);
  const month = Number(match[2]);
  let year = match[3] ? Number(match[3]) : now.getUTCFullYear();
  if (match[3] && match[3].length === 2) year += 2000;
  if (!isRealDate(year, month, day)) {
    return { ok: false, message: 'Такой даты не существует' };
  }
  const iso = new Date(Date.UTC(year, month - 1, day, END_OF_DAY_HOUR, END_OF_DAY_MINUTE)).toISOString();
  return { ok: true, iso };
}

/** Состояние срока. Без срока — null, чтобы вызывающий не рисовал пустую метку. */
export function dueDateState(dueAt: string | null | undefined, now: Date = new Date()): DueState | null {
  if (!dueAt) return null;
  const due = Date.parse(dueAt);
  if (Number.isNaN(due)) return null;
  const diff = due - now.getTime();
  if (diff < 0) return 'overdue';
  if (diff <= DAY_MS) return 'today';
  if (diff <= 3 * DAY_MS) return 'soon';
  return 'later';
}

/** «05.10.2026» из ISO. Берём календарную часть, чтобы день не «съезжал». */
export function formatDueDate(dueAt: string | null | undefined): string {
  if (!dueAt) return '';
  const [datePart] = dueAt.split('T');
  const [year, month, day] = (datePart || '').split('-');
  if (!year || !month || !day) return '';
  return `${day}.${month}.${year}`;
}

/** Подпись под суммой: «Просрочен · до 05.10.2026». */
export function dueDateLabel(dueAt: string | null | undefined, now: Date = new Date()): string {
  const state = dueDateState(dueAt, now);
  if (!state) return '';
  const date = formatDueDate(dueAt);
  if (state === 'overdue') return `Просрочен · до ${date}`;
  if (state === 'today') return `Сегодня · до ${date}`;
  return `До ${date}`;
}

type Sortable = Pick<Payment, 'id' | 'status' | 'created_at'> & { due_at?: string | null };

/**
 * Очерёдность: сначала неоплаченные со сроком (ближайший выше), затем
 * неоплаченные без срока, затем всё остальное — новыми вперёд.
 */
export function sortPaymentsByDue<T extends Sortable>(items: readonly T[]): T[] {
  const rank = (item: T) => {
    if (item.status !== 'pending') return 2;
    return item.due_at ? 0 : 1;
  };
  return [...items].sort((a, b) => {
    const rankDiff = rank(a) - rank(b);
    if (rankDiff !== 0) return rankDiff;
    if (rank(a) === 0) {
      const dueDiff = Date.parse(a.due_at as string) - Date.parse(b.due_at as string);
      if (dueDiff !== 0) return dueDiff;
    }
    const createdDiff = Date.parse(b.created_at) - Date.parse(a.created_at);
    if (createdDiff !== 0) return createdDiff;
    return a.id.localeCompare(b.id);
  });
}
