/**
 * Русское склонение для непрочитанных сообщений.
 * Правила: 1/21/31 → сообщение; 2–4 (кроме 12–14) → сообщения; иначе сообщений.
 */
export function pluralRu(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(Math.trunc(n));
  const mod100 = abs % 100;
  const mod10 = abs % 10;
  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

/** «5 непрочитанных сообщений» / «1 непрочитанное сообщение» */
export function formatUnreadMessagesRu(count: number): string {
  const n = Math.max(0, Math.trunc(count || 0));
  const noun = pluralRu(n, 'сообщение', 'сообщения', 'сообщений');
  const adj = pluralRu(n, 'непрочитанное', 'непрочитанных', 'непрочитанных');
  return `${n} ${adj} ${noun}`;
}

/** Компактный badge label: 0 → '', 1–99 → число, иначе 99+ */
export function formatBadgeCount(count: number): string {
  const n = Math.max(0, Math.trunc(count || 0));
  if (n <= 0) return '';
  if (n > 99) return '99+';
  return String(n);
}
