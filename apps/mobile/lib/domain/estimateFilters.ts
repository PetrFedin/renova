/** Фильтрация и метаданные строк сметы */
import { WORK_CATEGORY_LABEL, WORK_TYPES_FALLBACK, type WorkTypeOption } from '../../constants/workCatalog';
import type { EstimateLine } from '../api/types/project';

const EXPENSE_LABEL: Record<string, string> = {
  materials: 'Материалы',
  labor: 'Работы / бригада',
  delivery: 'Доставка',
  tools: 'Инструмент',
  other: 'Прочее',
};

export type EstimateLineTypeFilter = 'all' | 'work' | 'material';
export type EstimateLineSource = 'auto' | 'manual';

export function estimateLineSource(line: EstimateLine): EstimateLineSource {
  return line.calc_detail?.trim() ? 'auto' : 'manual';
}

export function estimateLineSourceLabel(line: EstimateLine): string {
  return estimateLineSource(line) === 'auto' ? 'Авто · из комнат' : 'Подрядчик · вручную';
}

/** Код статьи для фильтра — category из API или эвристика */
export function resolveEstimateCategory(line: EstimateLine): string {
  if (line.category?.trim()) return line.category.trim();
  if (line.line_type === 'material') return 'materials';
  return 'other';
}

export function estimateCategoryLabel(code: string, workTypes: WorkTypeOption[] = WORK_TYPES_FALLBACK): string {
  const wt = workTypes.find((t) => t.code === code);
  if (wt) return wt.name;
  const expense = EXPENSE_LABEL[code];
  if (expense) return expense;
  if (code === 'materials') return 'Материалы';
  return WORK_CATEGORY_LABEL[code] || code;
}

export function collectEstimateCategories(lines: EstimateLine[]): string[] {
  const set = new Set<string>();
  for (const line of lines) set.add(resolveEstimateCategory(line));
  return [...set].sort((a, b) => estimateCategoryLabel(a).localeCompare(estimateCategoryLabel(b), 'ru'));
}

export function filterEstimateLines(
  lines: EstimateLine[],
  filters: { lineType?: EstimateLineTypeFilter; category?: string | null },
): EstimateLine[] {
  return lines.filter((line) => {
    if (filters.lineType && filters.lineType !== 'all' && line.line_type !== filters.lineType) return false;
    if (filters.category && resolveEstimateCategory(line) !== filters.category) return false;
    return true;
  });
}

export function estimateTotals(lines: EstimateLine[]) {
  const works = lines.filter((l) => l.line_type === 'work');
  const materials = lines.filter((l) => l.line_type === 'material');
  const sum = (arr: EstimateLine[]) => arr.reduce((s, l) => s + l.quantity_planned * l.unit_price, 0);
  return {
    works: sum(works),
    materials: sum(materials),
    total: sum(lines),
    worksCount: works.length,
    materialsCount: materials.length,
  };
}
