/** Категории работ для каталога (группировка API /work-types) */
export const WORK_CATEGORY_LABEL: Record<string, string> = {
  prep: 'Подготовка',
  engineering: 'Инженерия',
  finish: 'Отделка',
  logistics: 'Логистика',
  furnish: 'Мебель',
  other: 'Прочее',
};

export type WorkTypeOption = { code: string; name: string; category: string };

/** Локальный fallback, если API недоступен */
export const WORK_TYPES_FALLBACK: WorkTypeOption[] = [
  { code: 'electrical', name: 'Электрика', category: 'engineering' },
  { code: 'outlet_install', name: 'Проводка / розетки', category: 'engineering' },
  { code: 'plumbing', name: 'Сантехника', category: 'engineering' },
  { code: 'sewage', name: 'Канализация', category: 'engineering' },
  { code: 'demolition', name: 'Демонтаж', category: 'prep' },
  { code: 'plaster', name: 'Штукатурка', category: 'finish' },
  { code: 'tiling', name: 'Плитка', category: 'finish' },
  { code: 'painting', name: 'Покраска', category: 'finish' },
  { code: 'floor_screed', name: 'Заливка пола / стяжка', category: 'finish' },
  { code: 'flooring', name: 'Напольные покрытия', category: 'finish' },
  { code: 'waste_removal', name: 'Вывоз мусора', category: 'logistics' },
  { code: 'furniture', name: 'Мебель', category: 'furnish' },
  { code: 'custom', name: 'Своя работа', category: 'other' },
];

export function groupWorkTypes(types: WorkTypeOption[]): { category: string; label: string; items: WorkTypeOption[] }[] {
  const map = new Map<string, WorkTypeOption[]>();
  for (const t of types) {
    const cat = t.category || 'other';
    if (!map.has(cat)) map.set(cat, []);
    map.get(cat)!.push(t);
  }
  return [...map.entries()].map(([category, items]) => ({
    category,
    label: WORK_CATEGORY_LABEL[category] || category,
    items,
  }));
}
