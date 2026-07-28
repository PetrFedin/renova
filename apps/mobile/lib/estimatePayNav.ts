/** W131: estimate lock → docs/schedule; payment; chat task/invoice (golden path SoT).
 * Clarity H: sheet вместо Alert. */
import { pushOsNav } from '@/lib/pushOsNav';
import {
  budgetTabRoute,
  calendarTabRoute,
  objectTabRoute,
  type OsRole,
} from '@/constants/osSections';
import { showActionConfirm } from '@/lib/actionConfirmBus';

/** Заказчик зафиксировал смету */
export function alertEstimateLocked(role: OsRole) {
  showActionConfirm({
    title: 'Смета зафиксирована',
    message: 'Дальше — договор в Документах и согласование графика.',
    primaryLabel: 'Документы',
    onPrimary: () => pushOsNav('/documents', undefined, role),
    secondaryLabel: 'График',
    onSecondary: () => pushOsNav(calendarTabRoute(role), undefined, role),
  });
}

/** Исполнитель отправил смету на согласование */
export function alertEstimateProposed(role: OsRole) {
  showActionConfirm({
    title: 'Смета у заказчика',
    message: 'Фиксацию подтверждает заказчик. Следите за входящими.',
    primaryLabel: 'Входящие',
    onPrimary: () => pushOsNav('/inbox', undefined, role),
    secondaryLabel: 'Позже',
    onSecondary: () => undefined,
  });
}

/** Заказчик отклонил предложение сметы */
export function alertEstimateLockRejected(role: OsRole) {
  showActionConfirm({
    title: 'Нужна правка сметы',
    message: 'Исполнитель получит уведомление и отправит новую версию.',
    primaryLabel: 'К смете',
    onPrimary: () => pushOsNav(objectTabRoute(role, 'estimate'), undefined, role),
    secondaryLabel: 'Позже',
    onSecondary: () => undefined,
  });
}

/** W136: исполнитель отозвал предложение фиксации */
export function alertEstimateProposalRevoked(role: OsRole = 'contractor') {
  showActionConfirm({
    title: 'Отозвано',
    message: 'Можно править смету и отправить снова.',
    primaryLabel: 'К смете',
    onPrimary: () => pushOsNav(objectTabRoute(role, 'estimate'), undefined, role),
    secondaryLabel: 'Позже',
    onSecondary: () => undefined,
  });
}

/** Подтверждение оплаты заказчиком */
export function alertPaymentConfirmed(role: OsRole) {
  showActionConfirm({
    title: 'Оплата подтверждена',
    message: 'Статус в бюджете и во «Входящих» у исполнителя.',
    primaryLabel: 'Сводка бюджета',
    onPrimary: () => pushOsNav(budgetTabRoute(role, 'summary'), undefined, role),
    secondaryLabel: 'Входящие',
    onSecondary: () => pushOsNav('/inbox', undefined, role),
  });
}

/** W135: исполнитель выставил счёт */
export function alertPaymentCreated(role: OsRole) {
  showActionConfirm({
    title: 'Счёт создан',
    message: 'Заказчику отправлено уведомление. Следите за оплатой во «Входящих».',
    primaryLabel: 'Оплаты',
    onPrimary: () => pushOsNav(budgetTabRoute(role, 'payments'), undefined, role),
    secondaryLabel: 'Входящие',
    onSecondary: () => pushOsNav('/inbox', undefined, role),
  });
}

/** Задача из сообщения чата */
export function alertChatTaskCreated(role: OsRole) {
  showActionConfirm({
    title: 'Задача создана',
    message: 'Появится в графике и во входящих.',
    primaryLabel: 'График',
    onPrimary: () => pushOsNav(calendarTabRoute(role), undefined, role),
    secondaryLabel: 'Позже',
    onSecondary: () => undefined,
  });
}

/** Счёт из чата — роль-aware CTA */
export function alertChatInvoiceCreated(role: OsRole, amount: number) {
  showActionConfirm({
    title: 'Счёт создан',
    message: `${amount.toLocaleString('ru-RU')} ₽ в «Деньги → Оплаты».`,
    primaryLabel: 'Открыть оплаты',
    onPrimary: () => pushOsNav(budgetTabRoute(role, 'payments'), undefined, role),
    secondaryLabel: 'Позже',
    onSecondary: () => undefined,
  });
}
