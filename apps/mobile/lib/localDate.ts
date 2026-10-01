/**
 * Календарная дата ПОЛЬЗОВАТЕЛЯ (YYYY-MM-DD) в его часовом поясе.
 * `new Date().toISOString().slice(0, 10)` даёт дату по UTC: в Москве (UTC+3) с 00:00 до 03:00
 * «сегодня» оказывалось вчера — календарь, просрочки и «на сегодня» сдвигались на сутки.
 */
export function localIsoDate(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Сегодня плюс/минус N календарных дней (по местному времени). */
export function todayIso(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return localIsoDate(d);
}
