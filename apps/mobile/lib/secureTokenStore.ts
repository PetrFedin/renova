/**
 * Хранение JWT: SecureStore если доступен, иначе AsyncStorage.
 * Staging/production: refresh не должен жить только в plain storage на устройстве.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

type Store = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  deleteItem: (key: string) => Promise<void>;
};

let _store: Store | null = null;

async function resolveStore(): Promise<Store> {
  if (_store) return _store;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const SecureStore = require('expo-secure-store');
    if (SecureStore?.getItemAsync && SecureStore?.setItemAsync) {
      _store = {
        getItem: (k) => SecureStore.getItemAsync(k),
        setItem: (k, v) => SecureStore.setItemAsync(k, v),
        deleteItem: (k) => SecureStore.deleteItemAsync(k),
      };
      return _store;
    }
  } catch {
    /* fall through */
  }
  _store = {
    getItem: (k) => AsyncStorage.getItem(k),
    setItem: (k, v) => AsyncStorage.setItem(k, v),
    deleteItem: (k) => AsyncStorage.removeItem(k),
  };
  return _store;
}

export async function secureGet(key: string): Promise<string | null> {
  return (await resolveStore()).getItem(key);
}

export async function secureSet(key: string, value: string): Promise<void> {
  await (await resolveStore()).setItem(key, value);
}

export async function secureDelete(key: string): Promise<void> {
  await (await resolveStore()).deleteItem(key);
}

export async function secureMultiRemove(keys: string[]): Promise<void> {
  const s = await resolveStore();
  await Promise.all(keys.map((k) => s.deleteItem(k)));
}
