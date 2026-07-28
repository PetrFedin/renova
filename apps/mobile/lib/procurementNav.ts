/** W127–W128: selections → purchase lifecycle → budget fact (Buildertrend/Smetter).
 * Clarity G: sheet вместо Alert. */
import { pushOsNav } from '@/lib/pushOsNav';
import {
  budgetTabRoute,
  calendarTabRoute,
  objectTabRoute,
  repairTabRoute,
  type OsRole,
} from '@/constants/osSections';
import { showActionConfirm } from '@/lib/actionConfirmBus';

/** Заказчик согласовал позицию — подрядчик может создать закупку */
export function alertMaterialPickApproved(role: OsRole) {
  showActionConfirm({
    title: 'Материал согласован',
    message: 'После закупки и статуса «В факте» сумма попадёт в факт бюджета.',
    primaryLabel: 'К материалам',
    onPrimary: () => pushOsNav(repairTabRoute(role, 'materials'), undefined, role),
    secondaryLabel: 'Позже',
    onSecondary: () => undefined,
  });
}

/** Подрядчик отправил на согласование */
export function alertMaterialPickSubmitted(role: OsRole) {
  showActionConfirm({
    title: 'На согласование',
    message: 'Заказчик получит задачу. После «Согласовать» можно создать закупку.',
    primaryLabel: 'К материалам',
    onPrimary: () => pushOsNav(repairTabRoute(role, 'materials'), undefined, role),
    secondaryLabel: 'Позже',
    onSecondary: () => undefined,
  });
}

/** Создана закупка из согласованных позиций */
export function alertPurchaseCreated(role: OsRole, count: number) {
  showActionConfirm({
    title: 'Закупка создана',
    message: `${count} поз. · отметьте заказ → оплату → доставку. В факт бюджета — только «В факте».`,
    primaryLabel: 'Сканировать чек',
    onPrimary: () => pushOsNav('/scan-receipt', undefined, role),
    secondaryLabel: 'Расходы',
    onSecondary: () => pushOsNav(budgetTabRoute(role, 'expenses'), undefined, role),
  });
}

/** Подрядчик отправил ДО заказчику */
export function alertChangeOrderSubmitted(role: OsRole) {
  showActionConfirm({
    title: 'Доп. работы',
    message: 'Отправлено заказчику. После согласования сумма войдёт в план бюджета.',
    primaryLabel: 'К изменениям',
    onPrimary: () =>
      pushOsNav(
        {
          pathname: objectTabRoute(role, 'estimate').pathname,
          params: { ...objectTabRoute(role, 'estimate').params, estimateLayer: 'changes' },
        },
        undefined,
        role,
      ),
    secondaryLabel: 'Позже',
    onSecondary: () => undefined,
  });
}

/** Заказчик одобрил ДО — план бюджета + опционально подпись */
export function alertChangeOrderApproved(
  role: OsRole,
  amountLabel: string,
  documentId?: string,
) {
  if (documentId) {
    showActionConfirm({
      title: 'Доп. работы одобрены',
      message: `${amountLabel} в плане бюджета. Подпишите черновик в Документах.`,
      primaryLabel: 'Подписать',
      onPrimary: () => pushOsNav('/documents', undefined, role),
      secondaryLabel: 'Открыть бюджет',
      onSecondary: () => pushOsNav(budgetTabRoute(role, 'summary'), undefined, role),
    });
    return;
  }
  showActionConfirm({
    title: 'Доп. работы одобрены',
    message: `${amountLabel} добавлено к плану бюджета.`,
    primaryLabel: 'Открыть бюджет',
    onPrimary: () => pushOsNav(budgetTabRoute(role, 'summary'), undefined, role),
    secondaryLabel: 'Позже',
    onSecondary: () => undefined,
  });
}

/** W128: шаг жизненного цикла закупки → факт / календарь / материалы */
export function alertPurchaseAdvanced(role: OsRole, status: string) {
  if (status === 'delivered') {
    showActionConfirm({
      title: 'Доставлено · в факте',
      message: 'Сумма учтена в факте бюджета. Можно сверить расходы или календарь.',
      primaryLabel: 'Расходы',
      onPrimary: () => pushOsNav(budgetTabRoute(role, 'expenses'), undefined, role),
      secondaryLabel: 'Календарь',
      onSecondary: () => pushOsNav(calendarTabRoute(role), undefined, role),
    });
    return;
  }
  if (status === 'cancelled') {
    showActionConfirm({
      title: 'Убрано из факта',
      message: 'Позиции снова доступны для закупки. Факт бюджета пересчитан.',
      primaryLabel: 'К материалам',
      onPrimary: () => pushOsNav(repairTabRoute(role, 'materials'), undefined, role),
      secondaryLabel: 'Позже',
      onSecondary: () => undefined,
    });
    return;
  }
  if (status === 'paid') {
    showActionConfirm({
      title: 'Оплачено',
      message: 'Отметьте доставку — тогда сумма попадёт в факт бюджета.',
      primaryLabel: 'Понятно',
      onPrimary: () => undefined,
    });
    return;
  }
  if (status === 'ordered') {
    showActionConfirm({
      title: 'Заказано у поставщика',
      message: 'Далее: оплата → доставка. После «Доставлено» — факт в бюджете.',
      primaryLabel: 'Календарь',
      onPrimary: () => pushOsNav(calendarTabRoute(role), undefined, role),
      secondaryLabel: 'Позже',
      onSecondary: () => undefined,
    });
  }
}

/** W128: чистовой selection (OsSelections) согласован → материалы/закупка */
export function alertSelectionApproved(role: OsRole) {
  showActionConfirm({
    title: 'Подбор согласован',
    message: 'Позиция в «Ремонт → Материалы → Потребности». Создайте закупку.',
    primaryLabel: 'К закупкам',
    onPrimary: () => pushOsNav(repairTabRoute(role, 'materials'), undefined, role),
    secondaryLabel: 'Позже',
    onSecondary: () => undefined,
  });
}

/** Подрядчик отправил selection заказчику */
export function alertSelectionProposed(role: OsRole) {
  showActionConfirm({
    title: 'На согласование',
    message: 'Заказчик увидит вариант в подборе. После согласования — закупка.',
    primaryLabel: 'К материалам',
    onPrimary: () => pushOsNav(repairTabRoute(role, 'materials'), undefined, role),
    secondaryLabel: 'Позже',
    onSecondary: () => undefined,
  });
}
