/** W125: после приёмки → оплата / план этажа SoT (Fieldwire acceptance pin на плане).
 * Clarity G: sheet вместо Alert. */
import { pushOsNav } from '@/lib/pushOsNav';
import { budgetTabRoute, objectTabRoute, type OsRole } from '@/constants/osSections';
import { showActionConfirm } from '@/lib/actionConfirmBus';

/** Бэкенд mark_acceptance_pin_on_plan ставит label «✓ этап» на FloorPlanPin */
export const ACCEPTANCE_PIN_HINT =
  'На плане этажа метка комнаты обновится на «✓ этап». Можно оплатить работы или открыть план.';

export function alertStageAccepted(role: OsRole) {
  showActionConfirm({
    title: 'Этап принят',
    message: ACCEPTANCE_PIN_HINT,
    primaryLabel: 'Оплатить',
    onPrimary: () => pushOsNav(budgetTabRoute(role, 'payments', { openPayment: '1' }), undefined, role),
    secondaryLabel: 'Открыть план',
    onSecondary: () => pushOsNav(objectTabRoute(role, 'plan'), undefined, role),
  });
}
