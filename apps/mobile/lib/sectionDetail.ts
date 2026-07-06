import AsyncStorage from '@react-native-async-storage/async-storage';
import { DetailLevel } from '@/lib/detailLevel';
const KEY = 'renova_section_detail';
export type SectionKey = 'rooms' | 'stages' | 'estimate' | 'calendar' | 'finance';
export async function getSectionDetail(s: SectionKey): Promise<DetailLevel> {
  const raw = await AsyncStorage.getItem(KEY);
  const map = raw ? JSON.parse(raw) : {};
  return map[s] || 'standard';
}
export async function setSectionDetail(s: SectionKey, l: DetailLevel) {
  const raw = await AsyncStorage.getItem(KEY);
  const map = raw ? JSON.parse(raw) : {};
  map[s] = l;
  await AsyncStorage.setItem(KEY, JSON.stringify(map));
}
