/** Локальный кэш лимита заказчика — офлайн и миграция до API */
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'renova_customer_budget_v1';

type Store = Record<string, number>;

async function readAll(): Promise<Store> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Store) : {};
  } catch {
    return {};
  }
}

export async function getCustomerBudget(projectId: string): Promise<number | null> {
  const all = await readAll();
  const v = all[projectId];
  return typeof v === 'number' && v > 0 ? v : null;
}

export async function setCustomerBudget(projectId: string, amount: number | null): Promise<void> {
  const all = await readAll();
  if (amount != null && amount > 0) all[projectId] = Math.round(amount);
  else delete all[projectId];
  await AsyncStorage.setItem(KEY, JSON.stringify(all));
}
