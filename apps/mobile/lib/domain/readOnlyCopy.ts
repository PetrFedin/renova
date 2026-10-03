/**
 * Гость «только просмотр»: нейтральные тексты вместо призывов к заказчику
 * («Оплатить 2 счёта», «Примите этап…», «приложите чек…»).
 * Чистые функции — покрыты lib/readOnlyCopy.test.ts.
 */
import type { OsNextAction } from './osTypes';
import { invoiceCountLabel } from './invoiceCountLabel';

type NavHref = OsNextAction['href'];

/** Убирает openPayment из ссылки: гость не открывает форму оплаты. */
export function stripOpenPayment(href: NavHref): NavHref {
  if (typeof href === 'string') return href.replace(/([?&])openPayment=[^&]*&?/, '$1').replace(/[?&]$/, '');
  if (href && typeof href === 'object' && 'params' in href && href.params) {
    const { openPayment: _drop, ...rest } = href.params as Record<string, unknown>;
    return { ...href, params: rest } as NavHref;
  }
  return href;
}

/** Заменяет призыв к действию заказчика нейтральной строкой статуса. */
export function neutralizeNextActionForReadOnly(
  action: OsNextAction,
  ctx: { unpaid: number; pendingPaymentTotalLabel?: string },
): OsNextAction {
  const href = stripOpenPayment(action.href);
  if (action.kind === 'payment') {
    return {
      ...action,
      title: ctx.unpaid > 0 ? `Выставлено ${invoiceCountLabel(ctx.unpaid)}` : 'Оплаты по проекту',
      subtitle: ctx.pendingPaymentTotalLabel ? `${ctx.pendingPaymentTotalLabel} ожидают оплаты заказчиком` : 'Оплату проводит заказчик',
      button: 'Счета',
      href,
    };
  }
  if (action.kind === 'accept') {
    const name = action.title.includes(': ') ? action.title.split(': ').slice(1).join(': ') : '';
    return {
      ...action,
      title: name ? `На приёмке: ${name}` : 'Работы на приёмке',
      subtitle: 'Решение принимает заказчик',
      button: 'Статус',
      href,
    };
  }
  if (action.title === 'Подключить исполнителя') {
    return { ...action, title: 'Проект в работе', subtitle: 'Следите за этапами, сроками и бюджетом', button: 'Работы', href };
  }
  if (action.kind === 'expense' || action.kind === 'material' || action.kind === 'review' || /^Подтвердить график/.test(action.title)) {
    return {
      ...action,
      title: 'Ждёт решения заказчика',
      subtitle: action.subtitle,
      button: 'Открыть',
      href,
    };
  }
  return { ...action, href };
}

export const READ_ONLY_PAYMENTS_HINT =
  'Счета по проекту. Оплату и подтверждение проводит заказчик; в режиме просмотра действия недоступны.';
export const READ_ONLY_ACCEPTANCE_HINT = 'Приёмку этапа выполняет заказчик. В режиме просмотра доступен только статус.';
