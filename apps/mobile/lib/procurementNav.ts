/** W127: selections → approve → purchase → budget fact (Buildertrend/Smetter chain) */
import { Alert } from 'react-native';
import { pushOsNav } from '@/lib/pushOsNav';
import { budgetTabRoute, objectTabRoute, repairTabRoute, type OsRole } from '@/constants/osSections';

/** Заказчик согласовал позицию — подрядчик может создать закупку */
export function alertMaterialPickApproved(role: OsRole) {
  Alert.alert(
    'Материал согласован',
    'После закупки и статуса «В факте» сумма попадёт в факт бюджета.',
    [
      { text: 'OK' },
      {
        text: 'К материалам',
        onPress: () => pushOsNav(repairTabRoute(role, 'materials'), undefined, role),
      },
    ],
  );
}

/** Подрядчик отправил на согласование */
export function alertMaterialPickSubmitted(role: OsRole) {
  Alert.alert(
    'На согласование',
    'Заказчик получит задачу. После «Согласовать» можно создать закупку.',
    [
      { text: 'OK' },
      {
        text: 'К материалам',
        onPress: () => pushOsNav(repairTabRoute(role, 'materials'), undefined, role),
      },
    ],
  );
}

/** Создана закупка из согласованных позиций */
export function alertPurchaseCreated(role: OsRole, count: number) {
  Alert.alert(
    'Закупка создана',
    `${count} поз. · отметьте заказ → оплату → доставку. В факт бюджета — только «В факте».`,
    [
      { text: 'OK' },
      {
        text: 'Расходы',
        onPress: () => pushOsNav(budgetTabRoute(role, 'expenses'), undefined, role),
      },
      {
        text: 'Сканировать чек',
        onPress: () => pushOsNav('/scan-receipt', undefined, role),
      },
    ],
  );
}

/** Подрядчик отправил ДО заказчику */
export function alertChangeOrderSubmitted(role: OsRole) {
  Alert.alert(
    'Доп. работы',
    'Отправлено заказчику. После согласования сумма войдёт в план бюджета.',
    [
      { text: 'OK' },
      {
        text: 'К изменениям',
        onPress: () =>
          pushOsNav(
            {
              pathname: objectTabRoute(role, 'estimate').pathname,
              params: { ...objectTabRoute(role, 'estimate').params, estimateLayer: 'changes' },
            },
            undefined,
            role,
          ),
      },
    ],
  );
}

/** Заказчик одобрил ДО — план бюджета + опционально подпись */
export function alertChangeOrderApproved(
  role: OsRole,
  amountLabel: string,
  documentId?: string,
) {
  const buttons: { text: string; style?: 'cancel'; onPress?: () => void }[] = [
    { text: 'OK', style: 'cancel' },
    {
      text: 'Открыть бюджет',
      onPress: () => pushOsNav(budgetTabRoute(role, 'summary'), undefined, role),
    },
  ];
  if (documentId) {
    buttons.push({
      text: 'Подписать',
      onPress: () => pushOsNav('/documents', undefined, role),
    });
  }
  Alert.alert(
    'Доп. работы одобрены',
    documentId
      ? `${amountLabel} в плане бюджета. Подпишите черновик в Документах.`
      : `${amountLabel} добавлено к плану бюджета.`,
    buttons,
  );
}
