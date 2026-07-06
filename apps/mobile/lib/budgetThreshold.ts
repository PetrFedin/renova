import AsyncStorage from '@react-native-async-storage/async-storage';
const KEY = 'renova_budget_threshold_pct';
export async function getBudgetThreshold(): Promise<number> {
  const v = await AsyncStorage.getItem(KEY);
  return v ? parseInt(v, 10) : 10;
}
export async function setBudgetThreshold(pct: number) {
  await AsyncStorage.setItem(KEY, String(Math.max(1, Math.min(50, pct))));
}
