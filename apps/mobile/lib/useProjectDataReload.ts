/** W89: подписка на projectDataBus → локальный reload экрана без remount. */
import { useEffect } from 'react';
import { subscribeProjectDataChanged } from '@/lib/projectDataBus';

/**
 * Когда другая поверхность сделала golden-path мутацию (syncProjectSideEffects),
 * экран с локальным state (приёмка, контроль) перечитывает данные.
 */
export function useProjectDataReload(reload: () => void | Promise<void>): void {
  useEffect(
    () =>
      subscribeProjectDataChanged(() => {
        try {
          void reload();
        } catch {
          /* noop */
        }
      }),
    [reload],
  );
}
