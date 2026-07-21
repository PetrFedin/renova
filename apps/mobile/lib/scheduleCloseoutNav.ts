/** W132: график согласование + closeout + подпись → SoT (Buildertrend schedule/closeout) */
import { Alert } from 'react-native';
import { pushOsNav, replaceOsNav } from '@/lib/pushOsNav';
import {
  calendarTabRoute,
  repairTabRoute,
  type OsRole,
} from '@/constants/osSections';

/** Исполнитель отправил график заказчику */
export function alertScheduleSubmitted(role: OsRole) {
  Alert.alert(
    'График отправлен',
    'Заказчик получит запрос на согласование. Следите за входящими.',
    [
      { text: 'OK' },
      {
        text: 'Входящие',
        onPress: () => pushOsNav('/inbox', undefined, role),
      },
    ],
  );
}

/** Заказчик согласовал график — даты этапов зафиксированы */
export function alertScheduleConfirmed(role: OsRole) {
  Alert.alert(
    'График согласован',
    'Даты этапов обновлены. Можно начинать работы по плану.',
    [
      { text: 'OK' },
      {
        text: 'График',
        onPress: () => pushOsNav(calendarTabRoute(role), undefined, role),
      },
      {
        text: 'Этапы',
        onPress: () => pushOsNav(repairTabRoute(role, 'works'), undefined, role),
      },
    ],
  );
}

/** График отклонён — правка сроков */
export function alertScheduleRejected(role: OsRole) {
  Alert.alert(
    'График отклонён',
    'Исполнитель получит уведомление и отправит новую версию.',
    [
      { text: 'OK' },
      {
        text: 'К графику',
        onPress: () => pushOsNav(calendarTabRoute(role), undefined, role),
      },
    ],
  );
}

/** Объект завершён (архив) */
export function alertCloseoutDone(role: OsRole, nextAction?: string) {
  Alert.alert(
    'Объект завершён',
    nextAction || 'Объект в архиве. Гарантия доступна после сдачи.',
    [
      { text: 'OK' },
      {
        text: 'На главную',
        onPress: () => replaceOsNav(`/(${role})/(tabs)/`, undefined, role),
      },
      {
        text: 'Документы',
        onPress: () => pushOsNav('/documents', undefined, role),
      },
    ],
  );
}

/** Подпись документа (in_app / kontur signed) */
export function alertDocumentSigned(role: OsRole, source: 'in_app' | 'kontur' = 'in_app') {
  const title = source === 'kontur' ? 'Контур: подписано' : 'Подписано';
  Alert.alert(
    title,
    'Документ сохранён. При готовности — завершение объекта или график работ.',
    [
      { text: 'OK' },
      {
        text: 'Документы',
        onPress: () => pushOsNav('/documents', undefined, role),
      },
      {
        text: 'График',
        onPress: () => pushOsNav(calendarTabRoute(role), undefined, role),
      },
    ],
  );
}
