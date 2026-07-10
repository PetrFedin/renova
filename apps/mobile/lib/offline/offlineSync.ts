import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';

export type OfflineMutation = {
  id: string;
  created_at: string;
  path: string;
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  user_id?: string;
  retries: number;
  last_error?: string;
};

export type OfflineSnapshot<T = unknown> = {
  key: string;
  saved_at: string;
  value: T;
};

const OUTBOX_KEY = 'renova_offline_outbox_v1';
const SNAPSHOT_PREFIX = 'renova_offline_snapshot:';
const MAX_RETRIES = 5;

function makeId() {
  return `offline_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

async function readJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
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

export async function getOutbox(): Promise<OfflineMutation[]> {
  return readJson<OfflineMutation[]>(OUTBOX_KEY, []);
}

export async function enqueueMutation(input: Omit<OfflineMutation, 'id' | 'created_at' | 'retries'>): Promise<OfflineMutation> {
  const item: OfflineMutation = {
    ...input,
    id: makeId(),
    created_at: new Date().toISOString(),
    retries: 0,
  };
  const queue = await getOutbox();
  queue.push(item);
  await writeJson(OUTBOX_KEY, queue);
  return item;
}

export async function removeMutation(id: string) {
  const queue = await getOutbox();
  await writeJson(OUTBOX_KEY, queue.filter((item) => item.id !== id));
}

export async function markMutationFailed(id: string, error: string) {
  const queue = await getOutbox();
  await writeJson(OUTBOX_KEY, queue.map((item) => (
    item.id === id ? { ...item, retries: item.retries + 1, last_error: error } : item
  )).filter((item) => item.retries <= MAX_RETRIES));
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

export async function syncOutbox(run: (item: OfflineMutation) => Promise<void>): Promise<{ synced: number; failed: number; pending: number }> {
  if (!(await isOnline())) {
    const pending = await getOutbox();
    return { synced: 0, failed: 0, pending: pending.length };
  }

  const queue = await getOutbox();
  let synced = 0;
  let failed = 0;

  for (const item of queue) {
    try {
      await run(item);
      await removeMutation(item.id);
      synced += 1;
    } catch (e) {
      failed += 1;
      await markMutationFailed(item.id, e instanceof Error ? e.message : 'sync_failed');
    }
  }

  const pending = await getOutbox();
  return { synced, failed, pending: pending.length };
}

export const offlineKeys = {
  outbox: OUTBOX_KEY,
  snapshotPrefix: SNAPSHOT_PREFIX,
};
