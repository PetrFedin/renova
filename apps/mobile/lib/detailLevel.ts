import AsyncStorage from '@react-native-async-storage/async-storage';

export type DetailLevel = 'brief' | 'standard' | 'detailed';

const KEY = 'renova_detail_level';

const listeners = new Set<() => void>();

export function subscribeDetailLevel(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

function notifyDetailLevelChanged() {
  listeners.forEach((fn) => fn());
}

export async function getDetailLevel(): Promise<DetailLevel> {
  const v = await AsyncStorage.getItem(KEY);
  return (v as DetailLevel) || 'standard';
}

export async function setDetailLevel(l: DetailLevel) {
  await AsyncStorage.setItem(KEY, l);
  notifyDetailLevelChanged();
}

export type DetailPreset = 'cosmetic' | 'capital' | 'house';
const PRESET_KEY = 'renova_detail_preset';
const PRESET_LEVELS: Record<DetailPreset, DetailLevel> = { cosmetic: 'brief', capital: 'standard', house: 'detailed' };

export async function getDetailPreset(): Promise<DetailPreset> {
  const v = await AsyncStorage.getItem(PRESET_KEY);
  return (v as DetailPreset) || 'capital';
}
export async function setDetailPreset(p: DetailPreset) {
  await AsyncStorage.setItem(PRESET_KEY, p);
  await setDetailLevel(PRESET_LEVELS[p]);
}
export const PRESET_LABELS: Record<DetailPreset, string> = { cosmetic: 'Косметика', capital: 'Капремонт', house: 'Дом/коттедж' };

const PRESET_TABS: Record<DetailPreset, import("@/lib/tabVisibility").TabKey[]> = {
  cosmetic: ["finance"],
  capital: ["estimate", "finance", "calendar"],
  house: ["estimate", "finance", "calendar", "guide"],
};
const ALL_TABS: import("@/lib/tabVisibility").TabKey[] = ["estimate", "guide", "finance", "calendar"];

export async function applyPresetTabs(p: DetailPreset) {
  const show = new Set(PRESET_TABS[p]);
  const hidden = ALL_TABS.filter(t => !show.has(t));
  await AsyncStorage.setItem("renova_tab_hidden", JSON.stringify(hidden));
}

const PRESET_SECTIONS: Record<DetailPreset, import("@/lib/homeSections").HomeSection[]> = {
  cosmetic: ["attention", "planfact"],
  capital: ["attention", "planfact", "analytics", "alerts"],
  house: ["attention", "planfact", "analytics", "alerts", "sections"],
};
const ALL_SEC: import("@/lib/homeSections").HomeSection[] = ["attention", "planfact", "analytics", "alerts", "sections"];

export async function applyPresetSections(p: DetailPreset) {
  const show = new Set(PRESET_SECTIONS[p]);
  const hidden = ALL_SEC.filter(s => !show.has(s));
  await AsyncStorage.setItem("renova_home_hidden", JSON.stringify(hidden));
}

export async function applyDetailPreset(p: DetailPreset) {
  await setDetailPreset(p);
  await applyPresetTabs(p);
  await applyPresetSections(p);
}
