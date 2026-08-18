export type NotificationDeliveryStore = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
};

type DeliveryEntry = {
  id: string;
  handledAt: number;
};

type NotificationDeliveryOptions = {
  now?: () => number;
  retentionMs?: number;
  maxEntries?: number;
  storageKey?: string;
  onStorageError?: (error: unknown) => void;
};

const DEFAULT_STORAGE_KEY = '@renova/handled-notification-deliveries:v1';
const DEFAULT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_MAX_ENTRIES = 128;
const MAX_DELIVERY_ID_LENGTH = 256;

function parseEntries(raw: string | null): DeliveryEntry[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry) => {
      if (typeof entry !== 'object' || entry === null) return [];
      const candidate = entry as Partial<DeliveryEntry>;
      if (
        typeof candidate.id !== 'string' ||
        !candidate.id.trim() ||
        typeof candidate.handledAt !== 'number' ||
        !Number.isFinite(candidate.handledAt)
      ) {
        return [];
      }
      return [{ id: candidate.id.trim(), handledAt: candidate.handledAt }];
    });
  } catch {
    return [];
  }
}

export function notificationDeliveryId(
  data: Record<string, unknown> | undefined,
): string | undefined {
  const raw = data?.delivery_id ?? data?.outbox_id;
  if (typeof raw !== 'string') return undefined;
  const normalized = raw.trim();
  if (!normalized || normalized.length > MAX_DELIVERY_ID_LENGTH) return undefined;
  return normalized;
}

export function createNotificationDeliveryRunner(
  store: NotificationDeliveryStore,
  options: NotificationDeliveryOptions = {},
): (
  deliveryId: string | undefined,
  action: () => void | Promise<void>,
) => Promise<boolean> {
  const now = options.now ?? Date.now;
  const retentionMs = options.retentionMs ?? DEFAULT_RETENTION_MS;
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const storageKey = options.storageKey ?? DEFAULT_STORAGE_KEY;
  const onStorageError = options.onStorageError;

  if (!Number.isFinite(retentionMs) || retentionMs <= 0) {
    throw new Error('notification_delivery_retention_must_be_positive');
  }
  if (!Number.isInteger(maxEntries) || maxEntries <= 0) {
    throw new Error('notification_delivery_max_entries_must_be_positive');
  }
  if (!storageKey.trim()) {
    throw new Error('notification_delivery_storage_key_required');
  }

  let tail: Promise<void> = Promise.resolve();

  return async (deliveryId, action) => {
    const normalizedId = deliveryId?.trim();
    if (!normalizedId) {
      await action();
      return true;
    }

    const run = async (): Promise<boolean> => {
      const handledAt = now();
      const cutoff = handledAt - retentionMs;
      let entries: DeliveryEntry[];
      try {
        entries = parseEntries(await store.getItem(storageKey));
      } catch (error) {
        onStorageError?.(error);
        await action();
        return true;
      }

      const fresh = entries.filter((entry) => entry.handledAt >= cutoff);
      if (fresh.some((entry) => entry.id === normalizedId)) {
        return false;
      }

      await action();

      const next = [
        { id: normalizedId, handledAt },
        ...fresh.filter((entry) => entry.id !== normalizedId),
      ].slice(0, maxEntries);
      try {
        await store.setItem(storageKey, JSON.stringify(next));
      } catch (error) {
        // silent-catch-ok: caller reporter observes storage failure; navigation
        // already succeeded and must remain available during storage outages.
        onStorageError?.(error);
      }
      return true;
    };

    const result = tail.then(run, run);
    tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
}
