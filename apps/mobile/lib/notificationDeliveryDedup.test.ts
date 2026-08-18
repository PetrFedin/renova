import {
  createNotificationDeliveryRunner,
  notificationDeliveryId,
  type NotificationDeliveryStore,
} from './notificationDeliveryDedup';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

class MemoryStore implements NotificationDeliveryStore {
  values = new Map<string, string>();

  async getItem(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async setItem(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }
}

async function main(): Promise<void> {
  assert(
    notificationDeliveryId({ delivery_id: '  delivery-new  ', outbox_id: 'legacy' }) ===
      'delivery-new',
    'delivery_id must take precedence and normalize whitespace',
  );
  assert(
    notificationDeliveryId({ outbox_id: 'legacy-outbox' }) === 'legacy-outbox',
    'legacy outbox_id must remain compatible',
  );
  assert(notificationDeliveryId({}) === undefined, 'missing delivery identity must remain supported');

  const concurrentStore = new MemoryStore();
  const runConcurrent = createNotificationDeliveryRunner(concurrentStore, {
    storageKey: 'concurrent',
  });
  let concurrentOpens = 0;
  const outcomes = await Promise.all([
    runConcurrent('delivery-1', async () => {
      concurrentOpens += 1;
      await Promise.resolve();
    }),
    runConcurrent('delivery-1', () => {
      concurrentOpens += 1;
    }),
  ]);
  assert(concurrentOpens === 1, 'concurrent duplicate responses must navigate exactly once');
  assert(
    outcomes.filter(Boolean).length === 1,
    'only one concurrent duplicate may claim successful navigation',
  );

  let now = 1_000;
  const expiryStore = new MemoryStore();
  const runExpiry = createNotificationDeliveryRunner(expiryStore, {
    now: () => now,
    retentionMs: 500,
    storageKey: 'expiry',
  });
  let expiryOpens = 0;
  assert(await runExpiry('delivery-expiry', () => void (expiryOpens += 1)), 'first open must run');
  assert(
    !(await runExpiry('delivery-expiry', () => void (expiryOpens += 1))),
    'duplicate inside retention must be suppressed',
  );
  now += 501;
  assert(
    await runExpiry('delivery-expiry', () => void (expiryOpens += 1)),
    'expired delivery identity must be allowed again',
  );
  assert(expiryOpens === 2, 'retention expiry must restore navigation');

  const boundedStore = new MemoryStore();
  const runBounded = createNotificationDeliveryRunner(boundedStore, {
    maxEntries: 2,
    storageKey: 'bounded',
  });
  await runBounded('one', () => undefined);
  await runBounded('two', () => undefined);
  await runBounded('three', () => undefined);
  const boundedRaw = await boundedStore.getItem('bounded');
  const boundedEntries = JSON.parse(boundedRaw ?? '[]') as unknown[];
  assert(boundedEntries.length === 2, 'persistent delivery history must remain bounded');

  const corruptStore = new MemoryStore();
  corruptStore.values.set('corrupt', '{bad json');
  const runCorrupt = createNotificationDeliveryRunner(corruptStore, {
    storageKey: 'corrupt',
  });
  let corruptOpens = 0;
  assert(
    await runCorrupt('repair-me', () => void (corruptOpens += 1)),
    'corrupt history must fail open',
  );
  assert(corruptOpens === 1, 'corrupt history must not block navigation');
  assert(
    Array.isArray(JSON.parse((await corruptStore.getItem('corrupt')) ?? 'null')),
    'corrupt history must be repaired after successful navigation',
  );

  const failedActionStore = new MemoryStore();
  const runFailedAction = createNotificationDeliveryRunner(failedActionStore, {
    storageKey: 'failed-action',
  });
  let failedActionAttempts = 0;
  let failed = false;
  try {
    await runFailedAction('retryable', () => {
      failedActionAttempts += 1;
      throw new Error('router unavailable');
    });
  } catch {
    failed = true;
  }
  assert(failed, 'navigation errors must remain observable');
  assert(
    await runFailedAction('retryable', () => void (failedActionAttempts += 1)),
    'failed navigation must not poison future retry',
  );
  assert(failedActionAttempts === 2, 'failed navigation must be retryable');

  const unavailableStore: NotificationDeliveryStore = {
    async getItem() {
      throw new Error('storage unavailable');
    },
    async setItem() {
      throw new Error('storage unavailable');
    },
  };
  const runUnavailable = createNotificationDeliveryRunner(unavailableStore);
  let failOpenCount = 0;
  assert(
    await runUnavailable('delivery-storage-outage', () => void (failOpenCount += 1)),
    'storage outage must fail open',
  );
  assert(failOpenCount === 1, 'storage outage must not make notifications unopenable');

  const legacyStore = new MemoryStore();
  const runLegacy = createNotificationDeliveryRunner(legacyStore);
  let legacyOpens = 0;
  assert(
    await runLegacy(undefined, () => void (legacyOpens += 1)),
    'legacy notifications without identity must open',
  );
  assert(
    await runLegacy(undefined, () => void (legacyOpens += 1)),
    'legacy notifications without identity must not be accidentally deduplicated',
  );
  assert(legacyOpens === 2, 'legacy fallback must preserve prior behavior');

  console.log('notificationDeliveryDedup.test OK');
}

void main().catch((error) => {
  throw error;
});
