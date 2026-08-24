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
import type { ChatInviteDeliveryStatus } from '@/lib/api/chats';

type ChatInviteTruth = {
  channel: 'sms' | 'in_app';
  status: ChatInviteDeliveryStatus;
};

function chatInviteCopy(truth?: ChatInviteTruth): { title: string; message: string } {
  if (!truth) {
    return {
      title: 'Приглашение сохранено',
      message: 'Статус доставки пока не подтверждён. Renova не считает это доказательством отправки сообщения.',
    };
  }
  switch (truth.status) {
    case 'in_app_notified':
      return {
        title: 'Приглашение сохранено',
        message: 'Уведомление создано в Renova для зарегистрированного участника.',
      };
    case 'in_app_queued':
    case 'in_app_retrying':
      return {
        title: 'Приглашение сохранено',
        message: 'Уведомление участнику поставлено в надёжную очередь Renova.',
      };
    case 'in_app_failed_terminal':
      return {
        title: 'Приглашение сохранено',
        message: 'Уведомление пока не доставлено. Ошибка сохранена для восстановления.',
      };
    case 'sms_provider_accepted':
      return {
        title: 'SMS передано провайдеру',
        message: 'SMS-провайдер принял сообщение и выдал идентификатор. Доставка на устройство ещё не подтверждена.',
      };
    case 'sms_preview':
      return {
        title: 'Приглашение сохранено',
        message: 'В текущей среде SMS работает в preview-режиме и не считается реальной доставкой.',
      };
    case 'sms_queued':
    case 'sms_retrying':
      return {
        title: 'Приглашение сохранено',
        message: 'SMS поставлено в надёжную очередь. Renova не показывает его как отправленное до подтверждения провайдера.',
      };
    case 'sms_delivery_unknown':
      return {
        title: 'Приглашение сохранено',
        message: 'После сетевого сбоя статус SMS неизвестен. Автоматический повтор остановлен, чтобы не отправить дубль.',
      };
    case 'sms_failed_terminal':
      return {
        title: 'Приглашение сохранено',
        message: 'SMS не подтверждено. Ошибка зафиксирована и может быть восстановлена оператором.',
      };
    default:
      return {
        title: 'Приглашение сохранено',
        message: truth.channel === 'sms'
          ? 'Статус SMS уточняется; подтверждённая доставка не заявляется.'
          : 'Статус уведомления уточняется.',
      };
  }
}

/** Приглашение в чат — статус текста зависит от реального delivery evidence. */
export function alertChatInviteSent(role: OsRole, truth?: ChatInviteTruth) {
  const copy = chatInviteCopy(truth);
  showActionConfirm({
    title: copy.title,
    message: copy.message,
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
