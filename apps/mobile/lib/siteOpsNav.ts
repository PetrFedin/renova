/** W136: room change, archive, waste lifecycle, expense edit → SoT */
import { Alert } from 'react-native';
import { pushOsNav } from '@/lib/pushOsNav';
import {
  budgetTabRoute,
  objectTabRoute,
  repairTabRoute,
  type OsRole,
} from '@/constants/osSections';

/** Заказчик запросил изменение комнаты */
export function alertRoomChangeRequested(role: OsRole = 'customer') {
  Alert.alert(
    'Запрос отправлен',
    'Исполнитель согласует изменение. Следите во «Входящих» и в комнатах.',
    [
      { text: 'OK' },
      {
        text: 'Входящие',
        onPress: () => pushOsNav('/inbox', undefined, role),
      },
      {
        text: 'Согласования',
        onPress: () => pushOsNav('/approvals', undefined, role),
      },
    ],
  );
}

/** Комната в архиве */
export function alertRoomArchived(role: OsRole, roomName: string) {
  Alert.alert(
    'В архиве',
    `«${roomName}» скрыта из активных. Смотрите вкладку «Архив».`,
    [
      { text: 'OK' },
      {
        text: 'Комнаты',
        onPress: () => pushOsNav(objectTabRoute(role, 'rooms'), undefined, role),
      },
    ],
  );
}

/** Вывоз мусора: create / request / approve / complete */
export function alertWasteOrderAdvanced(role: OsRole, action: 'created' | 'requested' | 'approved' | 'completed') {
  const titles = {
    created: 'Заявка на контейнер',
    requested: 'Вывоз заказан',
    approved: 'Вывоз согласован',
    completed: 'Мусор вывезен',
  } as const;
  const bodies = {
    created: 'Заказчик сможет согласовать вывоз. Сумма в материалах/бюджете.',
    requested: 'Ожидайте согласования заказчика.',
    approved: 'Исполнитель отметит факт вывоза.',
    completed: 'Расход зафиксирован. Сверьте факт в расходах.',
  } as const;
  Alert.alert(titles[action], bodies[action], [
    { text: 'OK' },
    {
      text: 'Материалы',
      onPress: () => pushOsNav(repairTabRoute(role, 'materials'), undefined, role),
    },
    ...(action === 'completed'
      ? [
          {
            text: 'Расходы',
            onPress: () => pushOsNav(budgetTabRoute(role, 'expenses'), undefined, role),
          },
        ]
      : []),
  ]);
}

/** Правка траты в карточке расхода */
export function alertExpenseUpdated(role: OsRole) {
  Alert.alert(
    'Трата обновлена',
    'Fact бюджета пересчитан. Можно сверить сводку.',
    [
      { text: 'OK' },
      {
        text: 'Расходы',
        onPress: () => pushOsNav(budgetTabRoute(role, 'expenses'), undefined, role),
      },
      {
        text: 'Сводка',
        onPress: () => pushOsNav(budgetTabRoute(role, 'summary'), undefined, role),
      },
    ],
  );
}

/** Удаление траты */
export function alertExpenseDeleted(role: OsRole) {
  Alert.alert(
    'Трата удалена',
    'Сумма убрана из факта бюджета.',
    [
      { text: 'OK' },
      {
        text: 'Сводка',
        onPress: () => pushOsNav(budgetTabRoute(role, 'summary'), undefined, role),
      },
    ],
  );
}
