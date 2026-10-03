/** Дробные числа по-русски: запятая, без хвостовых нулей («12,5 %», «13,2 м²»). */
export function formatDecimal(value: number | string | null | undefined, maxFraction = 1): string {
  const n = typeof value === 'string' ? Number(value.replace(',', '.')) : value;
  if (n == null || !Number.isFinite(n)) return '0';
  const factor = 10 ** maxFraction;
  const rounded = Math.round(n * factor) / factor;
  const text = String(Math.abs(rounded) < 1e21 ? rounded : n);
  const [whole, frac] = text.replace('-', '').split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${rounded < 0 ? '-' : ''}${grouped}${frac ? `,${frac}` : ''}`;
}

/** «12,5 %» — как формат процентов в портале и на экранах этапа (пробел перед знаком). */
export function formatPercentRu(value: number | string | null | undefined, maxFraction = 1): string {
  return `${formatDecimal(value, maxFraction)} %`;
}

export function formatSqm(value: number | string | null | undefined): string {
  return `${formatDecimal(value, 1)} м²`;
}
