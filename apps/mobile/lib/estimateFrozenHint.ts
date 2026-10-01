/** EST-001: подсказка «смета зафиксирована и не пересчитана» + переход к допработе */
import type { OsRole } from '@/constants/osSections';
import { showActionConfirm } from '@/lib/actionConfirmBus';
import { changeOrderEstimateRoute } from '@/lib/pushLinks';
import { pushOsNav } from '@/lib/pushOsNav';

export const ESTIMATE_FROZEN_TITLE = 'Смета зафиксирована';
export const ESTIMATE_FROZEN_MESSAGE =
  'Смета зафиксирована и не пересчитана. Чтобы учесть изменение объёма работ, оформите допработу';
export const ESTIMATE_FROZEN_ACTION = 'Оформить допработу';

/** Ответ бэкенда помечен `estimate_frozen: true` (комнаты, согласование запроса) */
export function isEstimateFrozen(response: unknown): boolean {
  return typeof response === 'object' && response !== null
    && (response as { estimate_frozen?: unknown }).estimate_frozen === true;
}

/** Диалог с переходом к допработам (слой «Изменения» сметы) */
export function alertEstimateFrozen(role: OsRole, returnTo?: string) {
  showActionConfirm({
    title: ESTIMATE_FROZEN_TITLE,
    message: ESTIMATE_FROZEN_MESSAGE,
    primaryLabel: ESTIMATE_FROZEN_ACTION,
    onPrimary: () => pushOsNav(changeOrderEstimateRoute(role), returnTo, role),
    secondaryLabel: 'Позже',
    onSecondary: () => undefined,
  });
}
