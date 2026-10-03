/** W125: после приёмки → оплата / план этажа SoT (Fieldwire acceptance pin на плане).
 * Clarity G: sheet вместо Alert. */
import { pushOsNav } from '@/lib/pushOsNav';
import { budgetTabRoute, objectTabRoute, type OsRole } from '@/constants/osSections';
import { showActionConfirm } from '@/lib/actionConfirmBus';
import { api } from '@/lib/api';
import { ACCEPTANCE_PIN_HINT, ACCEPTANCE_NO_PLAN_HINT, stageAcceptedMessage } from '@/lib/acceptanceCopy';
import { reportError } from '@/lib/reportError';

export { ACCEPTANCE_PIN_HINT, ACCEPTANCE_NO_PLAN_HINT, stageAcceptedMessage };

/** hasPlan: есть ли у проекта хотя бы один план этажа (по умолчанию — неизвестно, без упоминания метки). */
export function alertStageAccepted(role: OsRole, hasPlan = false) {
  showActionConfirm({
    title: 'Этап принят',
    message: stageAcceptedMessage(hasPlan),
    primaryLabel: 'Оплатить',
    onPrimary: () => pushOsNav(budgetTabRoute(role, 'payments', { openPayment: '1' }), undefined, role),
    ...(hasPlan
      ? { secondaryLabel: 'Открыть план', onSecondary: () => pushOsNav(objectTabRoute(role, 'plan'), undefined, role) }
      : {}),
  });
}

/** Загружает планы и показывает лист; сбой загрузки — лист без упоминания плана (с отчётом об ошибке). */
export async function alertStageAcceptedForProject(role: OsRole, userId: string, projectId: string) {
  let hasPlan = false;
  try {
    hasPlan = (await api.listFloorPlans(userId, projectId)).length > 0;
  } catch (e) {
    reportError('acceptance.floorPlans', e, { projectId });
  }
  alertStageAccepted(role, hasPlan);
}
