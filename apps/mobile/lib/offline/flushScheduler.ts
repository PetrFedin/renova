/**
 * Периодический повтор офлайн-очереди (CMP-015).
 *
 * Раньше `flush` стартовал только по NetInfo/`online`/загрузке: онлайн-устройство при
 * 5xx держало «отложенные» (nextAttemptAt) задания до ручной синхронизации. Планировщик
 * ставит ОДИН таймер на ближайший `nextAttemptAt` и перепланируется после каждого
 * изменения очереди (flushBus сообщает и о постановке, и об окончании flush).
 * Шторма нет: нижняя граница интервала, пауза общего 429-gate, офлайн — ждём,
 * блокировки/конфликты и чужие задания не учитываются.
 */
import type { OfflineJob } from '@/lib/offlineQueue';

/** Не чаще одного запуска в это окно — защита от петли «flush → notify → flush». */
export const FLUSH_SCHEDULER_MIN_DELAY_MS = 2_000;
/** Если устройство офлайн — проверить ещё раз позже (возврат сети и так запускает flush). */
export const FLUSH_SCHEDULER_OFFLINE_RECHECK_MS = 30_000;

/**
 * Через сколько запускать flush (мс) либо `null`, если ждать нечего.
 * Учитываются только задания текущего пользователя с выставленным `nextAttemptAt`.
 */
export function nextFlushDelayMs(
  jobs: readonly OfflineJob[],
  now: number,
  userId: string | null,
  pausedForMs = 0,
): number | null {
  let earliest: number | null = null;
  for (const job of jobs) {
    if (job.blocked || job.conflict) continue;
    if (job.userId && job.userId !== userId) continue;
    if (job.nextAttemptAt === undefined) continue;
    if (earliest === null || job.nextAttemptAt < earliest) earliest = job.nextAttemptAt;
  }
  if (earliest === null) return null;
  return Math.max(FLUSH_SCHEDULER_MIN_DELAY_MS, earliest - now, pausedForMs);
}

export type FlushSchedulerDeps = {
  getJobs: () => Promise<readonly OfflineJob[]>;
  flush: () => Promise<unknown>;
  isOnline: () => Promise<boolean>;
  /** Подписка на изменения очереди; возвращает отписку. */
  subscribe: (listener: () => void) => () => void;
  getUserId: () => string | null;
  /** Сколько ещё действует пауза общего 429-gate (0 — не действует). */
  pausedForMs: () => number;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  onError?: (error: unknown) => void;
};

export function startOfflineFlushScheduler(deps: FlushSchedulerDeps): () => void {
  const now = deps.now ?? Date.now;
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  let handle: unknown = null;
  let stopped = false;
  let planning = false;
  let replanRequested = false;

  const clear = () => {
    if (handle !== null) clearTimer(handle);
    handle = null;
  };

  const plan = async (): Promise<void> => {
    if (stopped) return;
    if (planning) {
      replanRequested = true;
      return;
    }
    planning = true;
    try {
      do {
        replanRequested = false;
        const jobs = await deps.getJobs();
        clear();
        if (stopped) return;
        const delay = nextFlushDelayMs(jobs, now(), deps.getUserId(), deps.pausedForMs());
        if (delay === null) continue;
        handle = setTimer(() => {
          handle = null;
          void fire();
        }, delay);
      } while (replanRequested);
    } catch (error) {
      deps.onError?.(error);
    } finally {
      planning = false;
    }
  };

  const fire = async (): Promise<void> => {
    if (stopped) return;
    try {
      if (deps.pausedForMs() > 0) {
        void plan();
        return;
      }
      if (!(await deps.isOnline())) {
        clear();
        handle = setTimer(() => {
          handle = null;
          void plan();
        }, FLUSH_SCHEDULER_OFFLINE_RECHECK_MS);
        return;
      }
      await deps.flush();
    } catch (error) {
      deps.onError?.(error);
    }
    // flush сам сообщает об окончании через subscribe, но перепланируем и без этого.
    void plan();
  };

  const unsubscribe = deps.subscribe(() => {
    void plan();
  });
  void plan();

  return () => {
    stopped = true;
    clear();
    unsubscribe();
  };
}
