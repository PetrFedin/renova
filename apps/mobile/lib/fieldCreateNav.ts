/** W133: create work/room, stage→acceptance, approvals, profile dates → SoT */
import { Alert } from 'react-native';
import { pushOsNav } from '@/lib/pushOsNav';
import {
  calendarTabRoute,
  objectTabRoute,
  repairTabRoute,
  type OsRole,
} from '@/constants/osSections';

/** Новая работа / задача на день */
export function alertWorkCreated(role: OsRole, workId?: string) {
  const buttons: { text: string; style?: 'cancel'; onPress?: () => void }[] = [
    { text: 'OK', style: 'cancel' },
    {
      text: 'График',
      onPress: () => pushOsNav(calendarTabRoute(role), undefined, role),
    },
  ];
  if (workId) {
    buttons.push({
      text: 'Открыть',
      onPress: () =>
        pushOsNav({ pathname: '/work-order/[id]', params: { id: workId } }, undefined, role),
    });
  }
  Alert.alert(
    'Работа создана',
    'Появится в графике. Можно сразу открыть карточку.',
    buttons,
  );
}

/** Новая комната на объекте */
export function alertRoomCreated(role: OsRole) {
  Alert.alert(
    'Комната добавлена',
    'Дальше — план этажа, смета или материалы по комнатам.',
    [
      { text: 'OK' },
      {
        text: 'План',
        onPress: () => pushOsNav(objectTabRoute(role, 'plan'), undefined, role),
      },
      {
        text: 'Смета',
        onPress: () => pushOsNav(objectTabRoute(role, 'estimate'), undefined, role),
      },
    ],
  );
}

/** Исполнитель сдал этап на приёмку */
export function alertStageSubmittedForAcceptance(role: OsRole) {
  Alert.alert(
    'На приёмке',
    'Заказчик получит запрос. Следите за входящими и приёмкой.',
    [
      { text: 'OK' },
      {
        text: 'Приёмка',
        onPress: () => pushOsNav(repairTabRoute(role, 'control'), undefined, role),
      },
      {
        text: 'Входящие',
        onPress: () => pushOsNav('/inbox', undefined, role),
      },
    ],
  );
}

/** Hub согласований — после решения (не CO — CO через procurementNav) */
export function alertApprovalApproved(role: OsRole, type: string) {
  if (type === 'material') {
    Alert.alert(
      'Согласовано',
      'Материал в потребностях. Можно создать закупку.',
      [
        { text: 'OK' },
        {
          text: 'К материалам',
          onPress: () => pushOsNav(repairTabRoute(role, 'materials'), undefined, role),
        },
      ],
    );
    return;
  }
  if (type === 'design' || type === 'room_change') {
    Alert.alert(
      'Согласовано',
      'Изменение принято. Откройте объект.',
      [
        { text: 'OK' },
        {
          text: 'Объект',
          onPress: () => pushOsNav(objectTabRoute(role, 'plan'), undefined, role),
        },
      ],
    );
    return;
  }
  Alert.alert('Согласовано', 'Решение сохранено. Исполнитель получит уведомление.', [
    { text: 'OK' },
    {
      text: 'Входящие',
      onPress: () => pushOsNav('/inbox', undefined, role),
    },
  ]);
}

export function alertApprovalRejected(role: OsRole, type: string) {
  Alert.alert(
    'Отклонено',
    'Исполнитель получит уведомление и сможет исправить.',
    [
      { text: 'OK' },
      type === 'material'
        ? {
            text: 'Материалы',
            onPress: () => pushOsNav(repairTabRoute(role, 'materials'), undefined, role),
          }
        : type === 'change_order'
          ? {
              text: 'Смета',
              onPress: () =>
                pushOsNav(
                  {
                    pathname: objectTabRoute(role, 'estimate').pathname,
                    params: { ...objectTabRoute(role, 'estimate').params, estimateLayer: 'changes' },
                  },
                  undefined,
                  role,
                ),
            }
          : {
              text: 'Входящие',
              onPress: () => pushOsNav('/inbox', undefined, role),
            },
    ],
  );
}

/** Профиль объекта: сроки → календарь */
export function alertProjectProfileSaved(role: OsRole, datesChanged?: boolean) {
  const buttons: { text: string; style?: 'cancel'; onPress?: () => void }[] = [{ text: 'OK' }];
  if (datesChanged) {
    buttons.push({
      text: 'График',
      onPress: () => pushOsNav(calendarTabRoute(role), undefined, role),
    });
  }
  Alert.alert(
    'Сохранено',
    datesChanged
      ? 'Профиль обновлён. Сроки можно сверить в графике.'
      : 'Профиль объекта обновлён.',
    buttons,
  );
}
