/** W134: chat/team invite, requisites, stage, estimate line, OCR → SoT CTAs.
 * Clarity H: sheet вместо Alert. */
import { pushOsNav } from '@/lib/pushOsNav';
import {
  budgetTabRoute,
  calendarTabRoute,
  objectTabRoute,
  repairTabRoute,
  type OsRole,
} from '@/constants/osSections';
import { showActionConfirm } from '@/lib/actionConfirmBus';

/** Приглашение в чат — участник появится в сообщениях */
export function alertChatInviteSent(role: OsRole) {
  showActionConfirm({
    title: 'Приглашение отправлено',
    message: 'После регистрации чат появится у участника в Сообщениях.',
    primaryLabel: 'Чаты',
    onPrimary: () => pushOsNav(`/(${role})/(tabs)/chat`, undefined, role),
    secondaryLabel: 'Позже',
    onSecondary: () => undefined,
  });
}

/** Приглашение в бригаду (профиль исполнителя) */
export function alertTeamInviteSent(role: OsRole = 'contractor') {
  showActionConfirm({
    title: 'Приглашение отправлено',
    message: 'Участник сможет войти по SMS или QR бригады.',
    primaryLabel: 'QR бригады',
    onPrimary: () => pushOsNav('/(contractor)/team-qr', undefined, role),
    secondaryLabel: 'Позже',
    onSecondary: () => undefined,
  });
}

/** Бригада создана — следующий шаг invite/QR */
export function alertTeamCreated(role: OsRole = 'contractor') {
  showActionConfirm({
    title: 'Бригада создана',
    message: 'Пригласите участников или покажите QR на объекте.',
    primaryLabel: 'QR бригады',
    onPrimary: () => pushOsNav('/(contractor)/team-qr', undefined, role),
    secondaryLabel: 'График',
    onSecondary: () => pushOsNav(calendarTabRoute(role), undefined, role),
  });
}

/** Реквизиты исполнителя → оплаты заказчика */
export function alertRequisitesSaved(role: OsRole = 'contractor') {
  showActionConfirm({
    title: 'Реквизиты сохранены',
    message: 'Заказчик увидит их при оплате по СБП / реквизитам.',
    primaryLabel: 'Оплаты',
    onPrimary: () => pushOsNav(budgetTabRoute(role, 'payments'), undefined, role),
    secondaryLabel: 'Позже',
    onSecondary: () => undefined,
  });
}

/** Новый этап → график / работы */
export function alertStageCreated(role: OsRole) {
  showActionConfirm({
    title: 'Этап создан',
    message: 'Появится в графике. Можно сразу назначить работы.',
    primaryLabel: 'График',
    onPrimary: () => pushOsNav(calendarTabRoute(role), undefined, role),
    secondaryLabel: 'Работы',
    onSecondary: () => pushOsNav(repairTabRoute(role, 'works'), undefined, role),
  });
}

/** Строка сметы → смета / фиксация */
export function alertEstimateLineAdded(role: OsRole) {
  showActionConfirm({
    title: 'Строка добавлена',
    message: 'Проверьте итог сметы и при необходимости отправьте на фиксацию.',
    primaryLabel: 'Смета',
    onPrimary: () => pushOsNav(objectTabRoute(role, 'estimate'), undefined, role),
    secondaryLabel: 'Позже',
    onSecondary: () => undefined,
  });
}

/** OCR документа → индекс документов / расходы */
export function alertDocumentOcrDone(role: OsRole) {
  showActionConfirm({
    title: 'OCR готов',
    message: 'Тип документа обновлён. Можно привязать к расходам или оставить в центре документов.',
    primaryLabel: 'Документы',
    onPrimary: () => pushOsNav('/documents', undefined, role),
    secondaryLabel: 'Расходы',
    onSecondary: () => pushOsNav(budgetTabRoute(role, 'expenses'), undefined, role),
  });
}
