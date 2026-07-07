/** Политика simple/advanced mode — что показывать по renova_detail_level */
import type { DetailLevel } from '@/lib/detailLevel';
import type { OsRole } from '@/constants/osSections';
import type { HomeWidgetId } from '@/constants/homeWidgets';

const CUSTOMER_FAB_STANDARD = ['expense', 'remark', 'photo', 'change', 'chat'];
const CUSTOMER_FAB_BRIEF = ['expense', 'chat'];

const BRIEF_HIDDEN_WIDGETS = new Set<HomeWidgetId>(['risks', 'kpi_analytics']);

export function fabActionIdsForLevel(level: DetailLevel, role: OsRole): Set<string> | null {
  if (role !== 'customer') return null;
  if (level === 'brief') return new Set(CUSTOMER_FAB_BRIEF);
  return new Set(CUSTOMER_FAB_STANDARD);
}

export function dockItemLabel(id: string, role: OsRole, defaultLabel: string): string {
  if (role !== 'customer') return defaultLabel;
  if (id === 'budget') return 'Деньги';
  return defaultLabel;
}

/** Brief — без фильтра по статьям в смете */
export function showEstimateCategoryFilters(level: DetailLevel): boolean {
  return level !== 'brief';
}

/** Brief — только однострочная подсказка на вкладках объекта */
export function objectTabGuideCompact(level: DetailLevel): boolean {
  return level !== 'detailed';
}

/** Brief — скрыть второстепенные виджеты на главной */
export function homeWidgetVisibleForLevel(id: HomeWidgetId, level: DetailLevel): boolean {
  if (level === 'brief' && BRIEF_HIDDEN_WIDGETS.has(id)) return false;
  return true;
}

/** Brief — короткие подсказки в wizard */
export function wizardHintsVerbose(level: DetailLevel): boolean {
  return level === 'detailed';
}
