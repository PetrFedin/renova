/**
 * Единый разбор чисел, введённых пользователем («12,5», «1 250,50», «−3»).
 * Возвращает null для пустого ввода и мусора — вызывающая форма обязана показать
 * ошибку, а не подставлять молчаливый 0/NaN (EST-008, CMP-013).
 */
export function parseLocaleNumber(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== 'string') return null;
  let s = raw
    // пробелы, неразрывные и узкие пробелы (разделители тысяч)
    .replace(/[\s   ]/g, '')
    // типографский минус и тире -> ASCII минус
    .replace(/[−–—]/g, '-');
  if (!s) return null;
  const negative = s.startsWith('-');
  if (negative) s = s.slice(1);
  if (!s || s.startsWith('-')) return null;
  const commas = (s.match(/,/g) ?? []).length;
  const dots = (s.match(/\./g) ?? []).length;
  if (commas + dots > 1) {
    // «1.250,50» / «1,250.50»: последний разделитель — десятичный, остальные — тысячи
    const lastSep = Math.max(s.lastIndexOf(','), s.lastIndexOf('.'));
    const intPart = s.slice(0, lastSep).replace(/[.,]/g, '');
    s = `${intPart}.${s.slice(lastSep + 1)}`;
    // два одинаковых разделителя подряд без дробной части («1.250.500») — только тысячи
    if (commas + dots > 1 && /^(\d{1,3})([.,]\d{3}){2,}$/.test(raw.replace(/[\s   ]/g, '').replace(/^-/, ''))) {
      s = raw.replace(/[^\d]/g, '');
    }
  } else {
    s = s.replace(',', '.');
  }
  if (!/^(\d+\.?\d*|\.\d+)$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

/** Число > 0 или null (суммы допсоглашения, платежа, расхода; размеры комнаты). */
export function parsePositiveNumber(raw: unknown): number | null {
  const n = parseLocaleNumber(raw);
  return n !== null && n > 0 ? n : null;
}

/** Число >= 0 или null. */
export function parseNonNegativeNumber(raw: unknown): number | null {
  const n = parseLocaleNumber(raw);
  return n !== null && n >= 0 ? n : null;
}

/** Целое >= 0 (розетки, точки) или null. */
export function parseNonNegativeInt(raw: unknown): number | null {
  const n = parseNonNegativeNumber(raw);
  return n !== null && Number.isInteger(n) ? n : null;
}
