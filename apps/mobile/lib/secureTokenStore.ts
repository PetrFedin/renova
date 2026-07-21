/**
 * Хранение JWT: SecureStore на iOS/Android, AsyncStorage на web / если native stub.
 *
 * Важно: на web `expo-secure-store` экспортирует setItemAsync, но ExpoSecureStore.web = {},
 * и вызов падает с `setValueWithKeyAsync is not a function`. Всегда проверяем isAvailableAsync.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

type Store = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  deleteItem: (key: string) => Promise<void>;
};

const asyncStore: Store = {
  getItem: (k) => AsyncStorage.getItem(k),
  setItem: (k, v) => AsyncStorage.setItem(k, v),
  deleteItem: (k) => AsyncStorage.removeItem(k),
};

let _store: Store | null = null;
let _resolving: Promise<Store> | null = null;

async function resolveStore(): Promise<Store> {
  if (_store) return _store;
  if (_resolving) return _resolving;

  _resolving = (async () => {
    // Preview / Expo web: native SecureStore недоступен
    if (Platform.OS === 'web') {
      _store = asyncStore;
      return _store;
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const SecureStore = require('expo-secure-store');
      const available =
        typeof SecureStore?.isAvailableAsync === 'function'
          ? await SecureStore.isAvailableAsync()
          : false;
      if (
        available &&
        typeof SecureStore.getItemAsync === 'function' &&
        typeof SecureStore.setItemAsync === 'function'
      ) {
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
    _store = asyncStore;
    return _store;
  })();

  try {
    return await _resolving;
  } finally {
    _resolving = null;
  }
}

/** При сбое native mid-flight — откат на AsyncStorage (не ломаем логин). */
async function withStoreFallback<T>(op: (s: Store) => Promise<T>): Promise<T> {
  const s = await resolveStore();
  try {
    return await op(s);
  } catch {
    _store = asyncStore;
    return op(asyncStore);
  }
}

export async function secureGet(key: string): Promise<string | null> {
  return withStoreFallback((s) => s.getItem(key));
}

export async function secureSet(key: string, value: string): Promise<void> {
  await withStoreFallback((s) => s.setItem(key, value));
}

export async function secureDelete(key: string): Promise<void> {
  await withStoreFallback((s) => s.deleteItem(key));
}

export async function secureMultiRemove(keys: string[]): Promise<void> {
  await withStoreFallback(async (s) => {
    await Promise.all(keys.map((k) => s.deleteItem(k)));
  });
}
