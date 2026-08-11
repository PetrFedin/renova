/** W130: заявки / старт этапа / бригада / WO → SoT (Houzz leads + Fieldwire field ops).
 * Clarity H: sheet вместо Alert. */
import { pushOsNav, replaceOsNav } from '@/lib/pushOsNav';
import {
  budgetTabRoute,
  calendarTabRoute,
  repairTabRoute,
  type OsRole,
} from '@/constants/osSections';
import { showActionConfirm } from '@/lib/actionConfirmBus';

export function alertJobLeadCreated(role: OsRole) {
  showActionConfirm({
    title: 'Заявка создана',
    message: 'Исполнители увидят объект и смогут прислать КП.',
    primaryLabel: 'К заявкам',
    onPrimary: () => pushOsNav('/job-leads', undefined, role),
    secondaryLabel: 'Позже',
    onSecondary: () => undefined,
  });
}

export function alertJobLeadQuoted(role: OsRole) {
  showActionConfirm({
    title: 'КП отправлено',
    message: 'Заказчик получит оценку. После принятия — объект в кабинете.',
    primaryLabel: 'К заявкам',
    onPrimary: () => pushOsNav('/job-leads', undefined, role),
    secondaryLabel: 'Позже',
    onSecondary: () => undefined,
  });
}

export function alertJobLeadAssigned(role: OsRole) {
  showActionConfirm({
    title: 'Исполнитель закреплён',
    message: 'Заявка готова к преобразованию в проект. Откройте её и нажмите «→ Проект».',
    primaryLabel: 'К заявке',
    onPrimary: () => pushOsNav('/job-leads', undefined, role),
    secondaryLabel: 'Позже',
    onSecondary: () => undefined,
  });
}

/** Этап начат — даты в графике (B6 honesty + CTA) */
export function alertStageStarted(role: OsRole) {
  showActionConfirm({
    title: 'Этап начат',
    message: 'Сроки отражены в графике. Назначьте работы или откройте календарь.',
    primaryLabel: 'График',
    onPrimary: () => pushOsNav(calendarTabRoute(role), undefined, role),
    secondaryLabel: 'Работы',
    onSecondary: () => pushOsNav(repairTabRoute(role, 'works'), undefined, role),
  });
}

/** Скан invite QR — в бригаде */
export function alertTeamJoined(role: OsRole = 'contractor') {
  showActionConfirm({
    title: 'Вы в бригаде',
    message: 'Откройте главную объекта или календарь задач.',
    primaryLabel: 'На главную',
    onPrimary: () => replaceOsNav(`/(${role})/(tabs)/`, undefined, role),
    secondaryLabel: 'График',
    onSecondary: () => pushOsNav(calendarTabRoute(role), undefined, role),
  });
}

/** Переход WorkOrder — следующие шаги golden path */
export function alertWorkOrderAdvanced(role: OsRole, next: string) {
  if (next === 'review') {
    showActionConfirm({
      title: 'На приёмке',
      message: 'Заказчик может принять работы по этапу или замечанию.',
      primaryLabel: 'Приёмка',
      onPrimary: () => pushOsNav(repairTabRoute(role, 'control'), undefined, role),
      secondaryLabel: 'Позже',
      onSecondary: () => undefined,
    });
    return;
  }
  if (next === 'done') {
    showActionConfirm({
      title: 'Работа выполнена',
      message: 'Можно выставить оплату или открыть график.',
      primaryLabel: 'Оплаты',
      onPrimary: () => pushOsNav(budgetTabRoute(role, 'payments'), undefined, role),
      secondaryLabel: 'График',
      onSecondary: () => pushOsNav(calendarTabRoute(role), undefined, role),
    });
    return;
  }
  if (next === 'paid') {
    showActionConfirm({
      title: 'Оплачено',
      message: 'Сумма в бюджете. Сверьте расходы при необходимости.',
      primaryLabel: 'Бюджет',
      onPrimary: () => pushOsNav(budgetTabRoute(role, 'summary'), undefined, role),
      secondaryLabel: 'Позже',
      onSecondary: () => undefined,
    });
    return;
  }
  if (next === 'in_progress') {
    showActionConfirm({
      title: 'В работе',
      message: 'Этап и календарь обновятся на главной.',
      primaryLabel: 'График',
      onPrimary: () => pushOsNav(calendarTabRoute(role), undefined, role),
      secondaryLabel: 'Позже',
      onSecondary: () => undefined,
    });
  }
}
