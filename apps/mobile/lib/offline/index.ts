/**
 * Offline utilities — единая точка экспорта (A-01).
 * Canonical storage: `@/lib/offlineQueue` (`renova_offline_queue`).
 */
export * from './outbox';
export * from './sync';
export { subscribeOfflineFlush, notifyOfflineFlush } from './flushBus';
/** Snapshots + NetInfo helper — не путать с очередью мутаций. */
export {
  isOnline,
  saveSnapshot,
  getSnapshot,
  clearSnapshot,
  offlineKeys,
} from './offlineSync';
