/** Offline outbox — очередь исходящих изменений для будущей синхронизации. */
import AsyncStorage from '@react-native-async-storage/async-storage';

export type OfflineMutationMethod = 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type OfflineMutation = {
  id: string;
  path: string;
  method: OfflineMutationMethod;
  userId?: string;
  body?: unknown;
  createdAt: string;
  attempts: number;
  lastError?: string;
  blocked?: boolean;
};

const OUTBOX_KEY = 'renova_offline_outbox:v1';
const MAX_ATTEMPTS = 5;

function makeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function readOutbox(): Promise<OfflineMutation[]> {
  try {
    const raw = await AsyncStorage.getItem(OUTBOX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeOutbox(items: OfflineMutation[]) {
  await AsyncStorage.setItem(OUTBOX_KEY, JSON.stringify(items));
}

export const offlineOutbox = {
  async list() {
    return readOutbox();
  },

  async enqueue(input: Omit<OfflineMutation, 'id' | 'createdAt' | 'attempts' | 'blocked'>) {
    const items = await readOutbox();
    const item: OfflineMutation = {
      ...input,
      id: makeId(),
      createdAt: new Date().toISOString(),
      attempts: 0,
      blocked: false,
    };
    items.push(item);
    await writeOutbox(items);
    return item;
  },

  async remove(id: string) {
    const items = await readOutbox();
    await writeOutbox(items.filter((item) => item.id !== id));
  },

  async markFailed(id: string, error: unknown, permanent = false) {
    const items = await readOutbox();
    const message = error instanceof Error ? error.message : String(error || 'sync_failed');
    await writeOutbox(items.map((item) => {
      if (item.id !== id) return item;
      const attempts = item.attempts + 1;
      return {
        ...item,
        attempts,
        lastError: message,
        blocked: permanent || attempts >= MAX_ATTEMPTS,
      };
    }));
  },

  async retry(id: string) {
    const items = await readOutbox();
    await writeOutbox(items.map((item) => (
      item.id === id ? { ...item, attempts: 0, blocked: false, lastError: undefined } : item
    )));
  },

  async clear() {
    await AsyncStorage.removeItem(OUTBOX_KEY);
  },
};

export { OUTBOX_KEY, MAX_ATTEMPTS };
