/** W125: после приёмки → оплата / план этажа SoT (Fieldwire acceptance pin на плане) */
import { Alert } from 'react-native';
import { pushOsNav } from '@/lib/pushOsNav';
import { budgetTabRoute, objectTabRoute, type OsRole } from '@/constants/osSections';

/** Бэкенд mark_acceptance_pin_on_plan ставит label «✓ этап» на FloorPlanPin */
export const ACCEPTANCE_PIN_HINT =
  'На плане этажа метка комнаты обновится на «✓ этап». Можно оплатить работы или открыть план.';

export function alertStageAccepted(role: OsRole) {
  Alert.alert('Этап принят', ACCEPTANCE_PIN_HINT, [
    { text: 'Позже', style: 'cancel' },
    {
      text: 'Оплатить',
      onPress: () => pushOsNav(budgetTabRoute(role, 'payments'), undefined, role),
    },
    {
      text: 'Открыть план',
      onPress: () => pushOsNav(objectTabRoute(role, 'plan'), undefined, role),
    },
  ]);
}
