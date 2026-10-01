import { useMemo, useState } from 'react';
import { createBusyGuard } from '@/lib/busyGuard';
import { showActionConfirm } from '@/lib/actionConfirmBus';

/**
 * Обёртка async-обработчика кнопки: блокирует повторное нажатие, показывает причину ошибки.
 * `run(fn, 'Заголовок ошибки')` → true при успехе.
 */
export function useBusyAction() {
  const [busy, setBusy] = useState(false);
  const guard = useMemo(() => createBusyGuard(setBusy), []);
  const run = (fn: () => Promise<void>, errorTitle = 'Не удалось выполнить') =>
    guard.run(fn, (message) => showActionConfirm({ title: errorTitle, message }));
  return { busy, run };
}
