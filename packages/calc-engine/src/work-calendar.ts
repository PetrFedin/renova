export interface WorkCalendar {
  /** Рабочие дни недели: 0 = понедельник, 6 = воскресенье. */
  workingWeekdays: readonly number[];
  /** Нерабочие дни проекта в виде смещений от дня 0. */
  excludedDays?: readonly number[];
  /** Принудительно рабочие дни, перекрывающие выходные и исключения. */
  includedDays?: readonly number[];
}

export const DEFAULT_WORK_CALENDAR: WorkCalendar = Object.freeze({
  workingWeekdays: Object.freeze([0, 1, 2, 3, 4]),
  excludedDays: Object.freeze([]),
  includedDays: Object.freeze([]),
});

export function validateWorkCalendar(calendar: WorkCalendar): void {
  if (!calendar.workingWeekdays.length) {
    throw new Error('Work calendar must contain at least one working weekday');
  }

  assertUniqueIntegerDays('workingWeekdays', calendar.workingWeekdays, 0, 6);
  assertUniqueIntegerDays('excludedDays', calendar.excludedDays ?? [], 0);
  assertUniqueIntegerDays('includedDays', calendar.includedDays ?? [], 0);
}

export function isWorkingDay(
  day: number,
  calendar: WorkCalendar = DEFAULT_WORK_CALENDAR,
): boolean {
  assertDay(day);
  validateWorkCalendar(calendar);

  const included = new Set(calendar.includedDays ?? []);
  if (included.has(day)) return true;

  const excluded = new Set(calendar.excludedDays ?? []);
  if (excluded.has(day)) return false;

  return calendar.workingWeekdays.includes(normalizeWeekday(day));
}

export function nextWorkingDay(
  day: number,
  calendar: WorkCalendar = DEFAULT_WORK_CALENDAR,
): number {
  assertDay(day);
  validateWorkCalendar(calendar);

  let candidate = day;
  while (!isWorkingDayUnchecked(candidate, calendar)) candidate += 1;
  return candidate;
}

/**
 * Возвращает окончание работы в календарных днях. Начало включительно,
 * окончание исключительно: работа в 1 рабочий день с начала 0 закончится в день 1.
 */
export function addWorkingDays(
  startDay: number,
  durationDays: number,
  calendar: WorkCalendar = DEFAULT_WORK_CALENDAR,
): number {
  assertDay(startDay);
  assertDuration(durationDays);
  validateWorkCalendar(calendar);

  if (durationDays === 0) return nextWorkingDay(startDay, calendar);

  let cursor = nextWorkingDay(startDay, calendar);
  let remaining = durationDays;

  while (remaining > 0) {
    if (isWorkingDayUnchecked(cursor, calendar)) remaining -= 1;
    cursor += 1;
  }

  return cursor;
}

export function countWorkingDays(
  startDay: number,
  finishDay: number,
  calendar: WorkCalendar = DEFAULT_WORK_CALENDAR,
): number {
  assertDay(startDay);
  assertDay(finishDay);
  if (finishDay < startDay) throw new Error('finishDay must not be earlier than startDay');
  validateWorkCalendar(calendar);

  let count = 0;
  for (let day = startDay; day < finishDay; day += 1) {
    if (isWorkingDayUnchecked(day, calendar)) count += 1;
  }
  return count;
}

function isWorkingDayUnchecked(day: number, calendar: WorkCalendar): boolean {
  if ((calendar.includedDays ?? []).includes(day)) return true;
  if ((calendar.excludedDays ?? []).includes(day)) return false;
  return calendar.workingWeekdays.includes(normalizeWeekday(day));
}

function normalizeWeekday(day: number): number {
  return ((day % 7) + 7) % 7;
}

function assertDay(day: number): void {
  if (!Number.isInteger(day) || day < 0) {
    throw new Error('Day must be a non-negative integer');
  }
}

function assertDuration(durationDays: number): void {
  if (!Number.isInteger(durationDays) || durationDays < 0) {
    throw new Error('Working duration must be a non-negative integer');
  }
}

function assertUniqueIntegerDays(
  field: string,
  days: readonly number[],
  minimum: number,
  maximum = Number.POSITIVE_INFINITY,
): void {
  const seen = new Set<number>();

  for (const day of days) {
    if (!Number.isInteger(day) || day < minimum || day > maximum) {
      throw new Error(`${field} contains invalid day: ${day}`);
    }
    if (seen.has(day)) throw new Error(`${field} contains duplicate day: ${day}`);
    seen.add(day);
  }
}
