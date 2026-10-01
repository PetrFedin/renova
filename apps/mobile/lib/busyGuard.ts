/** Чистое ядро «одна операция за раз + перехват ошибки» (двойной тап не дублирует запрос). */
export type BusyGuard = {
  isBusy: () => boolean;
  /** Возвращает true, если fn выполнилась без ошибки; false — если ошибка или уже занято. */
  run: (fn: () => Promise<void>, onError?: (message: string) => void) => Promise<boolean>;
};

export function errorMessage(e: unknown, fallback = 'Не удалось выполнить. Повторите позже.'): string {
  if (e instanceof Error && e.message.trim()) return e.message;
  return fallback;
}

export function createBusyGuard(onBusyChange?: (busy: boolean) => void): BusyGuard {
  let busy = false;
  return {
    isBusy: () => busy,
    async run(fn, onError) {
      if (busy) return false;
      busy = true;
      onBusyChange?.(true);
      try {
        await fn();
        return true;
      } catch (e) {
        onError?.(errorMessage(e));
        return false;
      } finally {
        busy = false;
        onBusyChange?.(false);
      }
    },
  };
}
