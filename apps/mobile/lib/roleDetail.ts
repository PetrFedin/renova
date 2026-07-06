import AsyncStorage from '@react-native-async-storage/async-storage';
import { DetailLevel } from '@/lib/detailLevel';
const KEY = 'renova_role_detail';
export async function getRoleDefault(role: 'customer' | 'contractor'): Promise<DetailLevel> {
  const raw = await AsyncStorage.getItem(KEY);
  const map = raw ? JSON.parse(raw) : { customer: 'standard', contractor: 'detailed' };
  return map[role] || 'standard';
}
export async function setRoleDefault(role: 'customer' | 'contractor', level: DetailLevel) {
  const raw = await AsyncStorage.getItem(KEY);
  const map = raw ? JSON.parse(raw) : {};
  map[role] = level;
  await AsyncStorage.setItem(KEY, JSON.stringify(map));
}
