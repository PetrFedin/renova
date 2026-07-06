import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  DOCK_DEFAULT, DOCK_MANDATORY, DOCK_MAX, DOCK_BY_ID,
  normalizeDock, migrateDockId, type DockItemId,
} from '@/constants/dockBar';
import type { OsRole } from '@/constants/osSections';

const key = (role: OsRole) => `renova_dock_bar_${role}`;

const listeners = new Set<() => void>();

/** Подписка — нижняя панель обновляется сразу после настроек в профиле */
export function subscribeDockBar(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

function notifyDockBarChanged() {
  listeners.forEach((fn) => fn());
}

export async function getDockBar(role: OsRole): Promise<DockItemId[]> {
  const raw = await AsyncStorage.getItem(key(role));
  if (!raw) return normalizeDock(DOCK_DEFAULT, { padFromDefault: true });
  try {
    const parsed = (JSON.parse(raw) as string[]).map((id) => migrateDockId(id) || id).filter(Boolean) as DockItemId[];
    return normalizeDock(parsed, { padFromDefault: parsed.length < DOCK_MAX });
  } catch {
    return normalizeDock(DOCK_DEFAULT, { padFromDefault: true });
  }
}

export async function setDockBar(role: OsRole, ids: DockItemId[]): Promise<DockItemId[]> {
  const next = normalizeDock(ids, { padFromDefault: false });
  if (!DOCK_MANDATORY.every((m) => next.includes(m))) throw new Error('mandatory');
  if (next.length !== DOCK_MAX) throw new Error('count');
  await AsyncStorage.setItem(key(role), JSON.stringify(next));
  notifyDockBarChanged();
  return next;
}

/** Переключить раздел: при 5/5 необязательный заменяется новым */
export async function toggleDockItem(
  role: OsRole,
  id: DockItemId,
): Promise<{ ids: DockItemId[]; replaced?: DockItemId }> {
  let cur = await getDockBar(role);
  if (!DOCK_BY_ID[id]) throw new Error('unknown');

  if (cur.includes(id)) {
    if (DOCK_MANDATORY.includes(id)) return { ids: cur };
    const filtered = cur.filter((x) => x !== id);
    if (filtered.length < DOCK_MAX) throw new Error('min');
    const next = normalizeDock(filtered, { padFromDefault: false });
    await AsyncStorage.setItem(key(role), JSON.stringify(next));
    notifyDockBarChanged();
    return { ids: next };
  }

  let replaced: DockItemId | undefined;
  if (cur.length >= DOCK_MAX) {
    const removable = cur.filter((x) => !DOCK_MANDATORY.includes(x));
    replaced = removable[removable.length - 1];
    if (!replaced) throw new Error('max');
    cur = cur.filter((x) => x !== replaced);
  }
  const ids = await setDockBar(role, [...cur, id]);
  return { ids, replaced };
}
