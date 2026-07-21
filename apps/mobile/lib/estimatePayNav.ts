/** W131: estimate lock → docs/schedule; payment; chat task/invoice (golden path SoT) */
import { Alert } from 'react-native';
import { pushOsNav } from '@/lib/pushOsNav';
import {
  budgetTabRoute,
  calendarTabRoute,
  objectTabRoute,
  type OsRole,
} from '@/constants/osSections';

/** Заказчик зафиксировал смету */
export function alertEstimateLocked(role: OsRole) {
  Alert.alert(
    'Смета зафиксирована',
    'Дальше — договор в Документах и согласование графика.',
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

/** Исполнитель отправил смету на согласование */
export function alertEstimateProposed(role: OsRole) {
  Alert.alert(
    'Смета у заказчика',
    'Фиксацию подтверждает заказчик. Следите за входящими.',
    [
      { text: 'OK' },
      {
        text: 'Входящие',
        onPress: () => pushOsNav('/inbox', undefined, role),
      },
    ],
  );
}

/** Заказчик отклонил предложение сметы */
export function alertEstimateLockRejected(role: OsRole) {
  Alert.alert(
    'Нужна правка сметы',
    'Исполнитель получит уведомление и отправит новую версию.',
    [
      { text: 'OK' },
      {
        text: 'К смете',
        onPress: () => pushOsNav(objectTabRoute(role, 'estimate'), undefined, role),
      },
    ],
  );
}

/** W136: исполнитель отозвал предложение фиксации */
export function alertEstimateProposalRevoked(role: OsRole = 'contractor') {
  Alert.alert(
    'Отозвано',
    'Можно править смету и отправить снова.',
    [
      { text: 'OK' },
      {
        text: 'К смете',
        onPress: () => pushOsNav(objectTabRoute(role, 'estimate'), undefined, role),
      },
    ],
  );
}

/** Подтверждение оплаты заказчиком */
export function alertPaymentConfirmed(role: OsRole) {
  Alert.alert(
    'Оплата подтверждена',
    'Статус в бюджете и во «Входящих» у исполнителя.',
    [
      { text: 'OK' },
      {
        text: 'Сводка бюджета',
        onPress: () => pushOsNav(budgetTabRoute(role, 'summary'), undefined, role),
      },
      {
        text: 'Входящие',
        onPress: () => pushOsNav('/inbox', undefined, role),
      },
    ],
  );
}

/** W135: исполнитель выставил счёт */
export function alertPaymentCreated(role: OsRole) {
  Alert.alert(
    'Счёт создан',
    'Заказчику отправлено уведомление. Следите за оплатой во «Входящих».',
    [
      { text: 'OK' },
      {
        text: 'Оплаты',
        onPress: () => pushOsNav(budgetTabRoute(role, 'payments'), undefined, role),
      },
      {
        text: 'Входящие',
        onPress: () => pushOsNav('/inbox', undefined, role),
      },
    ],
  );
}

/** Задача из сообщения чата */
export function alertChatTaskCreated(role: OsRole) {
  Alert.alert(
    'Задача создана',
    'Появится в графике и во входящих.',
    [
      { text: 'OK' },
      {
        text: 'График',
        onPress: () => pushOsNav(calendarTabRoute(role), undefined, role),
      },
    ],
  );
}

/** Счёт из чата — роль-aware CTA */
export function alertChatInvoiceCreated(role: OsRole, amount: number) {
  Alert.alert(
    'Счёт создан',
    `${amount.toLocaleString('ru-RU')} ₽ в «Деньги → Оплаты».`,
    [
      { text: 'OK' },
      {
        text: 'Открыть оплаты',
        onPress: () => pushOsNav(budgetTabRoute(role, 'payments'), undefined, role),
      },
    ],
  );
}
