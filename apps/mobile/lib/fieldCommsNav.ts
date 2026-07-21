/** W134: chat/team invite, requisites, stage, estimate line, OCR → SoT CTAs */
import { Alert } from 'react-native';
import { pushOsNav } from '@/lib/pushOsNav';
import {
  budgetTabRoute,
  calendarTabRoute,
  objectTabRoute,
  repairTabRoute,
  type OsRole,
} from '@/constants/osSections';

/** Приглашение в чат — участник появится в сообщениях */
export function alertChatInviteSent(role: OsRole) {
  Alert.alert(
    'Приглашение отправлено',
    'После регистрации чат появится у участника в Сообщениях.',
    [
      { text: 'OK' },
      {
        text: 'Чаты',
        onPress: () => pushOsNav(`/(${role})/(tabs)/chat`, undefined, role),
      },
    ],
  );
}

/** Приглашение в бригаду (профиль исполнителя) */
export function alertTeamInviteSent(role: OsRole = 'contractor') {
  Alert.alert(
    'Приглашение отправлено',
    'Участник сможет войти по SMS или QR бригады.',
    [
      { text: 'OK' },
      {
        text: 'QR бригады',
        onPress: () => pushOsNav('/(contractor)/team-qr', undefined, role),
      },
    ],
  );
}

/** Бригада создана — следующий шаг invite/QR */
export function alertTeamCreated(role: OsRole = 'contractor') {
  Alert.alert(
    'Бригада создана',
    'Пригласите участников или покажите QR на объекте.',
    [
      { text: 'OK' },
      {
        text: 'QR бригады',
        onPress: () => pushOsNav('/(contractor)/team-qr', undefined, role),
      },
      {
        text: 'График',
        onPress: () => pushOsNav(calendarTabRoute(role), undefined, role),
      },
    ],
  );
}

/** Реквизиты исполнителя → оплаты заказчика */
export function alertRequisitesSaved(role: OsRole = 'contractor') {
  Alert.alert(
    'Реквизиты сохранены',
    'Заказчик увидит их при оплате по СБП / реквизитам.',
    [
      { text: 'OK' },
      {
        text: 'Оплаты',
        onPress: () => pushOsNav(budgetTabRoute(role, 'payments'), undefined, role),
      },
    ],
  );
}

/** Новый этап → график / работы */
export function alertStageCreated(role: OsRole) {
  Alert.alert(
    'Этап создан',
    'Появится в графике. Можно сразу назначить работы.',
    [
      { text: 'OK' },
      {
        text: 'График',
        onPress: () => pushOsNav(calendarTabRoute(role), undefined, role),
      },
      {
        text: 'Работы',
        onPress: () => pushOsNav(repairTabRoute(role, 'works'), undefined, role),
      },
    ],
  );
}

/** Строка сметы → смета / фиксация */
export function alertEstimateLineAdded(role: OsRole) {
  Alert.alert(
    'Строка добавлена',
    'Проверьте итог сметы и при необходимости отправьте на фиксацию.',
    [
      { text: 'OK' },
      {
        text: 'Смета',
        onPress: () => pushOsNav(objectTabRoute(role, 'estimate'), undefined, role),
      },
    ],
  );
}

/** OCR документа → индекс документов / расходы */
export function alertDocumentOcrDone(role: OsRole) {
  Alert.alert(
    'OCR готов',
    'Тип документа обновлён. Можно привязать к расходам или оставить в центре документов.',
    [
      { text: 'OK' },
      {
        text: 'Документы',
        onPress: () => pushOsNav('/documents', undefined, role),
      },
      {
        text: 'Расходы',
        onPress: () => pushOsNav(budgetTabRoute(role, 'expenses'), undefined, role),
      },
    ],
  );
}
