/** W132: график согласование + closeout + подпись → SoT (Buildertrend schedule/closeout).
 * Clarity E: sheet вместо Alert для post-action CTA. */
import { pushOsNav, replaceOsNav } from '@/lib/pushOsNav';
import {
  calendarTabRoute,
  repairTabRoute,
  type OsRole,
} from '@/constants/osSections';
import { showActionConfirm } from '@/lib/actionConfirmBus';

/** Исполнитель отправил график заказчику */
export function alertScheduleSubmitted(role: OsRole) {
  showActionConfirm({
    title: 'График отправлен',
    message: 'Заказчик получит запрос на согласование. Следите за входящими.',
    primaryLabel: 'Входящие',
    onPrimary: () => pushOsNav('/inbox', undefined, role),
    secondaryLabel: 'Позже',
    onSecondary: () => undefined,
  });
}

/** Заказчик согласовал график — даты этапов зафиксированы */
export function alertScheduleConfirmed(role: OsRole) {
  showActionConfirm({
    title: 'График согласован',
    message: 'Даты этапов обновлены. Можно начинать работы по плану.',
    primaryLabel: 'График',
    onPrimary: () => pushOsNav(calendarTabRoute(role), undefined, role),
    secondaryLabel: 'Этапы',
    onSecondary: () => pushOsNav(repairTabRoute(role, 'works'), undefined, role),
  });
}

/** График отклонён — правка сроков */
export function alertScheduleRejected(role: OsRole) {
  showActionConfirm({
    title: 'График отклонён',
    message: 'Исполнитель получит уведомление и отправит новую версию.',
    primaryLabel: 'К графику',
    onPrimary: () => pushOsNav(calendarTabRoute(role), undefined, role),
    secondaryLabel: 'Позже',
    onSecondary: () => undefined,
  });
}

/** Объект завершён (архив) */
export function alertCloseoutDone(role: OsRole, nextAction?: string) {
  showActionConfirm({
    title: 'Объект завершён',
    message: nextAction || 'Объект в архиве. Гарантия доступна после сдачи.',
    primaryLabel: 'На главную',
    onPrimary: () => replaceOsNav(`/(${role})/(tabs)/`, undefined, role),
    secondaryLabel: 'Документы',
    onSecondary: () => pushOsNav('/documents', undefined, role),
  });
}

/** Подпись документа (in_app / kontur signed) */
export function alertDocumentSigned(role: OsRole, source: 'in_app' | 'kontur' = 'in_app') {
  const title = source === 'kontur' ? 'Контур: подписано' : 'Подписано';
  showActionConfirm({
    title,
    message: 'Документ сохранён. При готовности — завершение объекта или график работ.',
    primaryLabel: 'Документы',
    onPrimary: () => pushOsNav('/documents', undefined, role),
    secondaryLabel: 'График',
    onSecondary: () => pushOsNav(calendarTabRoute(role), undefined, role),
  });
}
