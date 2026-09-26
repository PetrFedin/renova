/**
 * Экран работы называл отмену «следующим шагом».
 *
 * На согласованной работе у заказчика остаётся единственное действие
 * «Отменить работу»: начать работу может только исполнитель. Экран печатал
 * заголовок «Следующий шаг» и под ним эту кнопку — человек читал, что
 * единственное, что ему осталось, это отменить. На живом экране я это и
 * увидел после согласования.
 *
 * Правило: если у роли нет хода вперёд, а у другой стороны он есть — сказать,
 * чей ход и какой.
 */
import {
  WORK_TRANSITIONS,
  isTransitionAllowedForRole,
  waitingForRole,
  waitingForText,
  workActions,
  type WorkOrderStatus,
} from './workLifecycle';

// 1. Согласованная работа: ход за исполнителем, и это сказано.
const approvedCustomer = workActions('approved', 'customer');
if (approvedCustomer.some((a) => a.next !== 'cancelled')) {
  throw new Error('у заказчика появился ход вперёд на approved — проверку нужно пересмотреть');
}
if (waitingForRole('approved', 'customer') !== 'contractor') {
  throw new Error('на согласованной работе ход должен быть за исполнителем');
}
const text = waitingForText('approved', 'customer');
if (text !== 'Ход за исполнителя: начать работу') {
  throw new Error(`неожиданный текст: ${text}`);
}

// 2. У того, чей ход, подсказки нет — у него есть кнопка.
if (waitingForRole('approved', 'contractor') !== null) throw new Error('исполнителю на approved подсказка не нужна');
if (waitingForText('approved', 'contractor') !== null) throw new Error('исполнителю на approved текста быть не должно');

// 3. Сдано на приёмку: ход за заказчиком. Возврат на доработку исполнителю
//    доступен, но это шаг назад — подсказку он не отменяет.
if (waitingForRole('review', 'contractor') !== 'customer') throw new Error('на приёмке ход за заказчиком');
if (waitingForText('review', 'contractor') !== 'Ход за заказчика: принять результат') {
  throw new Error(`неожиданный текст на review: ${waitingForText('review', 'contractor')}`);
}
if (waitingForRole('review', 'customer') !== null) throw new Error('заказчику на review подсказка не нужна');

// 4. Конечные состояния: ждать некого.
for (const st of ['done', 'paid', 'cancelled'] as WorkOrderStatus[]) {
  for (const role of ['customer', 'contractor'] as const) {
    if (waitingForRole(st, role) !== null) throw new Error(`${st}/${role}: ждать некого, а подсказка есть`);
  }
}

// 5. Общее правило по всем состояниям: подсказка появляется тогда и только
//    тогда, когда у роли нет хода вперёд, а у другой стороны он есть.
for (const st of Object.keys(WORK_TRANSITIONS) as WorkOrderStatus[]) {
  for (const role of ['customer', 'contractor'] as const) {
    const other = role === 'customer' ? 'contractor' : 'customer';
    const rank: Record<string, number> = { draft: 0, published: 1, negotiating: 2, approved: 3, in_progress: 4, review: 5, done: 6, paid: 7, cancelled: -1 };
    const forward = (WORK_TRANSITIONS[st] || []).filter((n) => n !== 'cancelled' && rank[n] > rank[st]);
    const mine = forward.some((n) => isTransitionAllowedForRole(st, n, role));
    const theirs = forward.some((n) => isTransitionAllowedForRole(st, n, other));
    const expected = !mine && theirs ? other : null;
    if (waitingForRole(st, role) !== expected) {
      throw new Error(`${st}/${role}: ожидалось ${expected}, получено ${waitingForRole(st, role)}`);
    }
  }
}

console.log('workWhoseTurn.test OK');
