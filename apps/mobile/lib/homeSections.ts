import AsyncStorage from '@react-native-async-storage/async-storage';
export type HomeSection = 'attention' | 'planfact' | 'analytics' | 'alerts' | 'sections';
const KEY = 'renova_home_hidden';
export async function getHiddenSections(): Promise<HomeSection[]> {
  const raw = await AsyncStorage.getItem(KEY);
  return raw ? JSON.parse(raw) : [];
}
export async function toggleSection(s: HomeSection) {
  const h = await getHiddenSections();
  const next = h.includes(s) ? h.filter(x => x !== s) : [...h, s];
  await AsyncStorage.setItem(KEY, JSON.stringify(next));
  return next;
}
