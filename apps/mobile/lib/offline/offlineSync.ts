/**
 * Offline helpers (A-01): NetInfo + read snapshots only.
 * Очередь мутаций — ТОЛЬКО `@/lib/offlineQueue` / `@/lib/offline` outbox façade.
 * Старый outbox в этом файле удалён, чтобы не было второго storage key.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';

export type OfflineSnapshot<T = unknown> = {
  key: string;
  saved_at: string;
  value: T;
};

const SNAPSHOT_PREFIX = 'renova_offline_snapshot:';

async function readJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

async function writeJson<T>(key: string, value: T) {
  await AsyncStorage.setItem(key, JSON.stringify(value));
}

export async function isOnline(): Promise<boolean> {
  const state = await NetInfo.fetch();
  return Boolean(state.isConnected && state.isInternetReachable !== false);
}

export async function saveSnapshot<T>(key: string, value: T): Promise<OfflineSnapshot<T>> {
  const snapshot: OfflineSnapshot<T> = { key, value, saved_at: new Date().toISOString() };
  await writeJson(`${SNAPSHOT_PREFIX}${key}`, snapshot);
  return snapshot;
}

export async function getSnapshot<T>(key: string): Promise<OfflineSnapshot<T> | null> {
  return readJson<OfflineSnapshot<T> | null>(`${SNAPSHOT_PREFIX}${key}`, null);
}

export async function clearSnapshot(key: string) {
  await AsyncStorage.removeItem(`${SNAPSHOT_PREFIX}${key}`);
}

export const offlineKeys = {
  /** @deprecated use OFFLINE_QUEUE_KEY from offlineQueue — единственная очередь */
  outbox: 'renova_offline_queue',
  snapshotPrefix: SNAPSHOT_PREFIX,
};
