/** Активность пункта dock — без двойной подсветки object+estimate. */
import type { DockItemId } from '@/constants/dockBar';
import { DOCK_BY_ID } from '@/constants/dockBar';

const REPAIR_SEGMENTS = new Set(['repair', 'works', 'materials', 'control', 'stages']);
const OBJECT_SEGMENTS = new Set(['object', 'rooms', 'estimate', 'plan']);

export type DockActiveCtx = {
  id: DockItemId;
  seg: string;
  section: string;
  hubTab?: string | null;
  /** Текущий набор кнопок dock (для взаимного исключения object/estimate) */
  items: readonly DockItemId[];
};

export function resolveDockItemActive({
  id,
  seg,
  section,
  hubTab,
  items,
}: DockActiveCtx): boolean {
  const item = DOCK_BY_ID[id];
  if (!item) return false;

  const onEstimate = seg === 'estimate' || hubTab === 'estimate';
  const onObjectHub = section === 'object' || OBJECT_SEGMENTS.has(seg);

  if (item.routeName === 'index') return seg === 'index' || seg === '(tabs)' || section === 'home';
  if (id === 'estimate') return onEstimate;
  if (id === 'object') {
    if (items.includes('estimate') && onEstimate) return false;
    return onObjectHub;
  }
  if (id === 'contractor' || id === 'more') return seg === 'profile';
  if (id === 'calendar') return seg === 'calendar';
  if (id === 'repair') return seg === 'repair' || REPAIR_SEGMENTS.has(seg);
  if (id === 'budget') {
    return seg === 'budget' || seg === 'finance' || seg === 'money' || section === 'budget';
  }
  if (id === 'chat') return seg === 'chat';
  return seg === item.routeName || item.id === section;
}
