export type ReloadTask = () => void | Promise<void>;

type SchedulerOptions = {
  debounceMs?: number;
  maxWaitMs?: number;
  onError?: (error: unknown) => void;
};

export type TrailingReloadScheduler = {
  schedule: () => void;
  flush: () => void;
  cancel: () => void;
};

/**
 * Coalesces event bursts without losing the final state change.
 *
 * - debounce: one refresh after a short burst;
 * - maxWait: continuous events cannot postpone refresh forever;
 * - trailing: events received during an active refresh cause one more refresh;
 * - cancel: timers and future trailing work are disabled on teardown.
 */
export function createTrailingReloadScheduler(
  task: ReloadTask,
  options: SchedulerOptions = {},
): TrailingReloadScheduler {
  const debounceMs = Math.max(0, options.debounceMs ?? 200);
  const maxWaitMs = Math.max(debounceMs, options.maxWaitMs ?? 1_000);

  let active = true;
  let inFlight = false;
  let trailing = false;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let maxWaitTimer: ReturnType<typeof setTimeout> | null = null;

  const clearTimers = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    if (maxWaitTimer) clearTimeout(maxWaitTimer);
    debounceTimer = null;
    maxWaitTimer = null;
  };

  const execute = () => {
    if (!active) return;
    clearTimers();

    if (inFlight) {
      trailing = true;
      return;
    }

    inFlight = true;
    trailing = false;
    void Promise.resolve()
      .then(task)
      .catch((error: unknown) => {
        options.onError?.(error);
      })
      .finally(() => {
        inFlight = false;
        if (!active || !trailing) return;
        trailing = false;
        schedule();
      });
  };

  const schedule = () => {
    if (!active) return;
    trailing = true;

    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(execute, debounceMs);
    if (!maxWaitTimer) maxWaitTimer = setTimeout(execute, maxWaitMs);
  };

  const flush = () => {
    if (!active) return;
    trailing = true;
    execute();
  };

  const cancel = () => {
    active = false;
    trailing = false;
    clearTimers();
  };

  return { schedule, flush, cancel };
}
