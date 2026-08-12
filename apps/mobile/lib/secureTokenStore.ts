/**
 * Хранение JWT: SecureStore на iOS/Android, AsyncStorage только на web.
 * Native secrets fail closed: недоступный/сломанный SecureStore никогда не
 * понижает хранение токенов до обычного AsyncStorage.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { reportError } from '@/lib/reportError';

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

function normalizeError(error: unknown, code: string): Error {
  return error instanceof Error ? error : new Error(code);
}

async function resolveStore(): Promise<Store> {
  if (_store) return _store;
  if (_resolving) return _resolving;

  _resolving = (async () => {
    // Browser storage is an explicit platform decision, not a native fallback.
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
        !available ||
        typeof SecureStore.getItemAsync !== 'function' ||
        typeof SecureStore.setItemAsync !== 'function' ||
        typeof SecureStore.deleteItemAsync !== 'function'
      ) {
        throw new Error('secure_store_unavailable');
      }

      _store = {
        getItem: (k) => SecureStore.getItemAsync(k),
        setItem: (k, v) => SecureStore.setItemAsync(k, v),
        deleteItem: (k) => SecureStore.deleteItemAsync(k),
      };
      return _store;
    } catch (error) {
      const normalized = normalizeError(error, 'secure_store_unavailable');
      reportError('secureTokenStore.resolve', normalized, { platform: Platform.OS });
      throw normalized;
    }
  })();

  try {
    return await _resolving;
  } finally {
    _resolving = null;
  }
}

async function withStore<T>(
  operation: 'get' | 'set' | 'delete' | 'multiDelete',
  key: string | undefined,
  op: (s: Store) => Promise<T>,
): Promise<T> {
  const s = await resolveStore();
  try {
    return await op(s);
  } catch (error) {
    const normalized = normalizeError(error, 'secure_token_store_failed');
    reportError('secureTokenStore.operation', normalized, {
      operation,
      ...(key ? { key } : {}),
      platform: Platform.OS,
    });
    throw normalized;
  }
}

export async function secureGet(key: string): Promise<string | null> {
  return withStore('get', key, (s) => s.getItem(key));
}

export async function secureSet(key: string, value: string): Promise<void> {
  await withStore('set', key, (s) => s.setItem(key, value));
}

export async function secureDelete(key: string): Promise<void> {
  await withStore('delete', key, (s) => s.deleteItem(key));
}

export async function secureMultiRemove(keys: string[]): Promise<void> {
  await withStore('multiDelete', undefined, async (s) => {
    await Promise.all(keys.map((k) => s.deleteItem(k)));
  });
}
