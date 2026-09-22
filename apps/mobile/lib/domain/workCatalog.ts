/**
 * Подбор работ для будущих этапов: фильтр каталога, выбор и свои работы.
 *
 * Каталог приходит из `/api/v1/work-types`; свои работы живут только в этой
 * сессии подбора и уходят на сервер как этап с `work_type: 'custom'` —
 * произвольных кодов работ backend не знает и знать не должен.
 */
export type WorkCatalogItem = {
  code: string;
  name: string;
  category: string;
  /** Работа, добавленная человеком вручную, а не пришедшая из каталога. */
  custom?: boolean;
};

export type StageDraft = { name: string; work_type: string };

export const WORK_CATEGORY_LABEL: Record<string, string> = {
  prep: 'Подготовка',
  engineering: 'Инженерия',
  finish: 'Отделка',
  furnish: 'Мебель и техника',
  logistics: 'Логистика',
  other: 'Прочее',
};

export const CUSTOM_WORK_TYPE = 'custom';
const CUSTOM_CODE_PREFIX = 'custom:';
const MAX_NAME_LENGTH = 64;

export function workCategoryLabel(category: string): string {
  return WORK_CATEGORY_LABEL[category] || 'Прочее';
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ');
}

/** Категории в порядке хода ремонта, только те, что реально есть в каталоге. */
export function catalogCategories(items: readonly WorkCatalogItem[]): string[] {
  const order = ['prep', 'engineering', 'finish', 'furnish', 'logistics', 'other'];
  const present = new Set(items.map((item) => item.category));
  const known = order.filter((category) => present.has(category));
  const extra = [...present].filter((category) => !order.includes(category)).sort();
  return [...known, ...extra];
}

export function filterWorkCatalog(
  items: readonly WorkCatalogItem[],
  query: string,
  category: string | null,
): WorkCatalogItem[] {
  const needle = normalize(query);
  return items.filter((item) => {
    if (category && item.category !== category) return false;
    if (!needle) return true;
    return normalize(item.name).includes(needle) || item.code.toLowerCase().includes(needle);
  });
}

export function toggleWorkSelection(selected: readonly string[], code: string): string[] {
  return selected.includes(code) ? selected.filter((item) => item !== code) : [...selected, code];
}

export type AddCustomResult =
  | { ok: true; items: WorkCatalogItem[]; code: string }
  | { ok: false; message: string };

/**
 * Добавляет свою работу в каталог сессии. Совпадение с уже имеющейся работой
 * не ошибка — возвращаем её код, чтобы человек просто увидел её отмеченной.
 */
export function addCustomWork(
  items: readonly WorkCatalogItem[],
  raw: string,
): AddCustomResult {
  const name = raw.trim().replace(/\s+/g, ' ');
  if (!name) return { ok: false, message: 'Введите название работы.' };
  if (name.length > MAX_NAME_LENGTH) {
    return { ok: false, message: `Название длиннее ${MAX_NAME_LENGTH} символов — сократите.` };
  }
  const existing = items.find((item) => normalize(item.name) === normalize(name));
  if (existing) return { ok: true, items: [...items], code: existing.code };
  const code = `${CUSTOM_CODE_PREFIX}${normalize(name).replace(/[^a-zа-я0-9]+/g, '-')}`;
  const collision = items.find((item) => item.code === code);
  if (collision) return { ok: true, items: [...items], code: collision.code };
  return {
    ok: true,
    items: [...items, { code, name, category: 'other', custom: true }],
    code,
  };
}

export function isCustomWorkCode(code: string): boolean {
  return code.startsWith(CUSTOM_CODE_PREFIX);
}

/**
 * Этапы создаются в порядке хода ремонта, а не в порядке кликов: иначе
 * «уборка» может оказаться первым этапом проекта.
 */
export function buildStageDrafts(
  items: readonly WorkCatalogItem[],
  selected: readonly string[],
): StageDraft[] {
  const order = catalogCategories(items);
  const chosen = items.filter((item) => selected.includes(item.code));
  const rank = (item: WorkCatalogItem) => {
    const index = order.indexOf(item.category);
    return index === -1 ? order.length : index;
  };
  return [...chosen]
    .sort((a, b) => {
      const diff = rank(a) - rank(b);
      if (diff !== 0) return diff;
      return selected.indexOf(a.code) - selected.indexOf(b.code);
    })
    .map((item) => ({
      name: item.name,
      work_type: isCustomWorkCode(item.code) ? CUSTOM_WORK_TYPE : item.code,
    }));
}
