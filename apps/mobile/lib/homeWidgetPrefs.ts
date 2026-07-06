import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  HOME_WIDGET_DEFAULT,
  HOME_WIDGET_STANDARD,
  HOME_WIDGET_CATALOG,
  HOME_WIDGET_PRESETS,
  type HomeWidgetId,
  type HomeWidgetPresetId,
  type HomeWidgetRole,
} from '@/constants/homeWidgets';

const key = (role: HomeWidgetRole) => `renova_home_widgets_${role}`;
const migrationKey = (role: HomeWidgetRole) => `renova_home_widgets_v3_${role}`;
const migrationV4Key = (role: HomeWidgetRole) => `renova_home_widgets_v4_${role}`;
const migrationV5Key = (role: HomeWidgetRole) => `renova_home_widgets_v5_${role}`;
const migrationV6Key = (role: HomeWidgetRole) => `renova_home_widgets_v6_${role}`;

const listeners = new Set<() => void>();

export function subscribeHomeWidgets(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

function notifyHomeWidgetsChanged() {
  listeners.forEach((fn) => fn());
}

const VALID = new Set(HOME_WIDGET_CATALOG.map((w) => w.id));

function normalize(ids: string[]): HomeWidgetId[] {
  const seen = new Set<HomeWidgetId>();
  const out: HomeWidgetId[] = [];
  for (const raw of ids) {
    if (!VALID.has(raw as HomeWidgetId) || seen.has(raw as HomeWidgetId)) continue;
    seen.add(raw as HomeWidgetId);
    out.push(raw as HomeWidgetId);
  }
  return out;
}

/** Старый «все 16 виджетов» → компактный стандарт */
async function maybeMigrateLegacyPrefs(role: HomeWidgetRole, parsed: HomeWidgetId[]): Promise<HomeWidgetId[] | null> {
  const done = await AsyncStorage.getItem(migrationKey(role));
  if (done) return null;
  const legacyFull = parsed.length >= 12 || parsed.includes('kpi_analytics' as HomeWidgetId);
  if (!legacyFull) {
    await AsyncStorage.setItem(migrationKey(role), '1');
    return null;
  }
  const next = normalize([...HOME_WIDGET_STANDARD]);
  await AsyncStorage.setItem(key(role), JSON.stringify(next));
  await AsyncStorage.setItem(migrationKey(role), '1');
  notifyHomeWidgetsChanged();
  return next;
}

/** Убрать works_materials с главной — перенос в «Подробно» */
async function maybeMigrateV4Prefs(role: HomeWidgetRole, parsed: HomeWidgetId[]): Promise<HomeWidgetId[] | null> {
  const done = await AsyncStorage.getItem(migrationV4Key(role));
  if (done) return null;
  if (!parsed.includes('works_materials')) {
    await AsyncStorage.setItem(migrationV4Key(role), '1');
    return null;
  }
  const next = normalize(parsed.filter((id) => id !== 'works_materials'));
  await AsyncStorage.setItem(key(role), JSON.stringify(next));
  await AsyncStorage.setItem(migrationV4Key(role), '1');
  notifyHomeWidgetsChanged();
  return next;
}

/** Убрать inbox с главной — дубль «Сообщений» */
async function maybeMigrateV5Prefs(role: HomeWidgetRole, parsed: HomeWidgetId[]): Promise<HomeWidgetId[] | null> {
  const done = await AsyncStorage.getItem(migrationV5Key(role));
  if (done) return null;
  if (!parsed.includes('inbox')) {
    await AsyncStorage.setItem(migrationV5Key(role), '1');
    return null;
  }
  const next = normalize(parsed.filter((id) => id !== 'inbox'));
  await AsyncStorage.setItem(key(role), JSON.stringify(next));
  await AsyncStorage.setItem(migrationV5Key(role), '1');
  notifyHomeWidgetsChanged();
  return next;
}

/** Убрать documents с главной — дубль меню ↑ и профиля */
async function maybeMigrateV6Prefs(role: HomeWidgetRole, parsed: HomeWidgetId[]): Promise<HomeWidgetId[] | null> {
  const done = await AsyncStorage.getItem(migrationV6Key(role));
  if (done) return null;
  if (!parsed.includes('documents')) {
    await AsyncStorage.setItem(migrationV6Key(role), '1');
    return null;
  }
  const next = normalize(parsed.filter((id) => id !== 'documents'));
  await AsyncStorage.setItem(key(role), JSON.stringify(next));
  await AsyncStorage.setItem(migrationV6Key(role), '1');
  notifyHomeWidgetsChanged();
  return next;
}

export async function getHomeWidgets(role: HomeWidgetRole): Promise<HomeWidgetId[]> {
  const raw = await AsyncStorage.getItem(key(role));
  if (!raw) return [...HOME_WIDGET_DEFAULT];
  try {
    const parsed = normalize(JSON.parse(raw) as string[]);
    if (!parsed.length) return [...HOME_WIDGET_DEFAULT];
    const migrated = await maybeMigrateLegacyPrefs(role, parsed);
    const base = migrated || parsed;
    const v4 = await maybeMigrateV4Prefs(role, base);
    const v5base = v4 || base;
    const v5 = await maybeMigrateV5Prefs(role, v5base);
    const v6base = v5 || v5base;
    const v6 = await maybeMigrateV6Prefs(role, v6base);
    return v6 || v6base;
  } catch {
    return [...HOME_WIDGET_DEFAULT];
  }
}

export async function setHomeWidgets(role: HomeWidgetRole, ids: HomeWidgetId[]): Promise<HomeWidgetId[]> {
  const next = normalize(ids);
  await AsyncStorage.setItem(key(role), JSON.stringify(next));
  await AsyncStorage.setItem(migrationKey(role), '1');
  notifyHomeWidgetsChanged();
  return next;
}

export async function applyHomeWidgetPreset(role: HomeWidgetRole, preset: HomeWidgetPresetId): Promise<HomeWidgetId[]> {
  return setHomeWidgets(role, [...HOME_WIDGET_PRESETS[preset].ids]);
}

export async function toggleHomeWidget(role: HomeWidgetRole, id: HomeWidgetId): Promise<HomeWidgetId[]> {
  const cur = await getHomeWidgets(role);
  const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
  return setHomeWidgets(role, next);
}

export async function resetHomeWidgets(role: HomeWidgetRole): Promise<HomeWidgetId[]> {
  return setHomeWidgets(role, [...HOME_WIDGET_DEFAULT]);
}
