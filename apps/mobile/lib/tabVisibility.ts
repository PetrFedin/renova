import AsyncStorage from '@react-native-async-storage/async-storage';
const KEY = 'renova_tab_hidden';
export type TabKey = 'estimate' | 'guide' | 'finance' | 'calendar';

/** По умолчанию скрываем редкие разделы — меньше шума в таббаре */
const DEFAULT_HIDDEN: TabKey[] = ['guide', 'calendar'];

export async function getHiddenTabs(): Promise<TabKey[]> {
  const raw = await AsyncStorage.getItem(KEY);
  if (raw === null) return DEFAULT_HIDDEN;
  return JSON.parse(raw);
}
export async function toggleTabVisibility(t: TabKey) {
  const h = await getHiddenTabs();
  const next = h.includes(t) ? h.filter(x => x !== t) : [...h, t];
  await AsyncStorage.setItem(KEY, JSON.stringify(next));
  return next;
}
