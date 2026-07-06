/** Нижняя панель — 5 кнопок, home + chat обязательны */
import type { TabIconKey } from '@/components/renova/TabIcon';

export type DockItemId =
  | 'home' | 'chat' | 'object' | 'repair' | 'budget' | 'calendar'
  | 'estimate' | 'contractor' | 'more';

export type DockItem = {
  id: DockItemId;
  routeName: string;
  label: string;
  icon: TabIconKey;
  /** query-параметр tab для hub-маршрутов */
  hubTab?: string;
};

export const DOCK_MAX = 5;
export const DOCK_MANDATORY: DockItemId[] = ['home', 'chat'];

/** Настраиваемые слоты — выбираются 3 из 4 (+ 2 обязательных = 5) */
export const DOCK_OPTIONAL: DockItemId[] = ['object', 'repair', 'budget', 'calendar'];
export const DOCK_OPTIONAL_SLOTS = DOCK_MAX - DOCK_MANDATORY.length;

/** Дефолт: главная, сообщения, объект, ремонт, бюджет */
export const DOCK_DEFAULT: DockItemId[] = ['home', 'chat', 'object', 'repair', 'budget'];

/** S8 — dynamic presets для заказчика (setup / repair) */
export const DOCK_PRESET_SETUP: DockItemId[] = ['home', 'object', 'estimate', 'contractor', 'more'];
export const DOCK_PRESET_REPAIR: DockItemId[] = ['home', 'repair', 'budget', 'chat', 'more'];

export const DOCK_CATALOG: DockItem[] = [
  { id: 'home', routeName: 'index', label: 'Главная', icon: 'home' },
  { id: 'chat', routeName: 'chat', label: 'Сообщения', icon: 'chat' },
  { id: 'object', routeName: 'object', label: 'Объект', icon: 'rooms' },
  { id: 'repair', routeName: 'repair', label: 'Ремонт', icon: 'works' },
  { id: 'budget', routeName: 'budget', label: 'Деньги', icon: 'budget' },
  { id: 'calendar', routeName: 'calendar', label: 'Календарь', icon: 'calendar' },
  { id: 'estimate', routeName: 'object', hubTab: 'estimate', label: 'Смета', icon: 'estimate' },
  { id: 'contractor', routeName: 'profile', label: 'Исполнитель', icon: 'profile' },
  { id: 'more', routeName: 'profile', label: 'Ещё', icon: 'more' },
];

export const DOCK_BY_ID = Object.fromEntries(DOCK_CATALOG.map((d) => [d.id, d])) as Record<DockItemId, DockItem>;

/** Миграция старых id из AsyncStorage */
const LEGACY_DOCK: Record<string, DockItemId> = {
  works: 'repair',
  materials: 'repair',
  control: 'repair',
  rooms: 'object',
  estimate: 'estimate',
  more: 'more',
};

export function migrateDockId(id: string): DockItemId | null {
  if (id in DOCK_BY_ID) return id as DockItemId;
  return LEGACY_DOCK[id] || null;
}

export function normalizeDock(ids: DockItemId[], opts?: { padFromDefault?: boolean }): DockItemId[] {
  const pad = opts?.padFromDefault ?? false;
  const seen = new Set<DockItemId>();
  const out: DockItemId[] = [];
  for (const raw of [...DOCK_MANDATORY, ...ids]) {
    const id = migrateDockId(raw) || raw;
    if (!DOCK_BY_ID[id] || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= DOCK_MAX) break;
  }
  if (pad) {
    for (const id of DOCK_DEFAULT) {
      if (out.length >= DOCK_MAX) break;
      if (!seen.has(id)) { seen.add(id); out.push(id); }
    }
  }
  return out.slice(0, DOCK_MAX);
}
