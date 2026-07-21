/**
 * Единая русская плюрализация (Intl.PluralRules('ru-RU')).
 * Не дублировать ручные count===1 / count<5 в UI.
 */

export type RuPluralCategory = 'zero' | 'one' | 'few' | 'many' | 'other';

export type RuPluralForms = {
  one: string;
  few: string;
  many: string;
  /** Fallback, если категория other/zero без своего ключа */
  other?: string;
  zero?: string;
};

/** [one, few, many] — короткий кортеж для существительных */
export type RuPluralTuple = readonly [one: string, few: string, many: string];

const rules = (() => {
  try {
    return new Intl.PluralRules('ru-RU', { type: 'cardinal' });
  } catch {
    return null;
  }
})();

/**
 * Нормализация: NaN/±Infinity → 0; сохраняем знак для отрицательных.
 * Дробные оставляем как есть (категория по |n|).
 */
export function normalizeCount(count: unknown): number {
  const n = typeof count === 'number' ? count : Number(count);
  if (!Number.isFinite(n)) return 0;
  return n;
}

/** Категория плюрализации ru-RU по абсолютному значению */
export function pluralCategoryRu(count: unknown): RuPluralCategory {
  const n = Math.abs(normalizeCount(count));
  if (!rules) {
    // Fallback без Intl (редкий runtime)
    const i = Math.floor(n);
    const mod10 = i % 10;
    const mod100 = i % 100;
    if (mod10 === 1 && mod100 !== 11) return 'one';
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'few';
    return 'many';
  }
  return rules.select(n) as RuPluralCategory;
}

function formsFromTuple(tuple: RuPluralTuple): RuPluralForms {
  return { one: tuple[0], few: tuple[1], many: tuple[2], other: tuple[2] };
}

function pickForm(category: RuPluralCategory, forms: RuPluralForms): string {
  switch (category) {
    case 'one':
      return forms.one;
    case 'few':
      return forms.few;
    case 'many':
      return forms.many;
    case 'zero':
      return forms.zero ?? forms.many ?? forms.other ?? forms.few;
    default:
      return forms.other ?? forms.many ?? forms.few;
  }
}

/**
 * Только словоформа (без числа).
 * pluralizeRu(2, ['задача', 'задачи', 'задач']) → 'задачи'
 */
export function pluralizeRu(
  count: unknown,
  forms: RuPluralForms | RuPluralTuple,
): string {
  const f = Array.isArray(forms) ? formsFromTuple(forms) : forms;
  return pickForm(pluralCategoryRu(count), f);
}

/**
 * Число + форма: formatCount(21, { one: 'сообщение', few: 'сообщения', many: 'сообщений' })
 * → '21 сообщение'
 */
export function formatCount(
  count: unknown,
  forms: RuPluralForms | RuPluralTuple,
): string {
  const n = normalizeCount(count);
  const form = pluralizeRu(n, forms);
  const display = Number.isInteger(n) ? String(n) : String(n);
  return `${display} ${form}`;
}

/**
 * Компактное отображение числа (знак, без «99+»).
 * 0, -1, 1.5, NaN→0.
 */
export function formatCompactCount(count: unknown): string {
  const n = normalizeCount(count);
  if (Number.isInteger(n)) return String(n);
  // Дроби: до 2 знаков без лишних нулей
  const rounded = Math.round(n * 100) / 100;
  return String(rounded);
}

/**
 * Badge: 0 → пусто (caller скрывает), 1..99 → число, ≥100 → «99+».
 * Отрицательные → как compact (редко для badge).
 */
export function formatBadgeCount(count: unknown): string {
  const n = normalizeCount(count);
  if (n <= 0) return '';
  if (n > 99) return '99+';
  if (Number.isInteger(n)) return String(n);
  return formatCompactCount(n);
}
