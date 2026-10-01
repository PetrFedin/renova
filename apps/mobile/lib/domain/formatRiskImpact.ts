/** Серверные строки риска содержат голые суммы («+18407733 ₽ к смете») — форматируем с разделителями (UI-007). */
export function formatRiskImpact(text: string | null | undefined): string {
  if (!text) return '';
  return text.replace(/(\d{4,})(\s*₽)/g, (_m, digits: string, rub: string) =>
    `${Number(digits).toLocaleString('ru-RU').replace(/ /g, ' ')}${rub}`,
  );
}
