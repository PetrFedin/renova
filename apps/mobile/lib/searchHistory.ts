import AsyncStorage from '@react-native-async-storage/async-storage';
const KEY = 'renova_search_history';
export async function pushSearch(q: string) {
  const s = q.trim(); if (!s) return;
  const raw = await AsyncStorage.getItem(KEY);
  const list: string[] = raw ? JSON.parse(raw) : [];
  await AsyncStorage.setItem(KEY, JSON.stringify([s, ...list.filter(x => x !== s)].slice(0, 5)));
}
export async function getSearchHistory(): Promise<string[]> {
  const raw = await AsyncStorage.getItem(KEY);
  return raw ? JSON.parse(raw) : [];
}
