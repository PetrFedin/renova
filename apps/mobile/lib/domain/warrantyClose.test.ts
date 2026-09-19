/**
 * Кнопка «Закрыть гарантию» не должна появляться на уже закрытом обращении.
 *
 * Бэкенд на повторное закрытие отвечает 200 ok — это нужно офлайн-очереди,
 * которая переигрывает отправку после потери связи. Проверено на стенде:
 * два подряд POST /warranty-claims/{id}/close дают 200 оба раза. Поэтому
 * защитить пользователя от бессмысленного нажатия может только клиент:
 * иначе ему сообщают об успешном закрытии того, что закрыто.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { canCloseWarranty, issueWaitingHint } from './issueLifecycle';

test('закрытую гарантию заказчику закрывать нечем', () => {
  assert.equal(canCloseWarranty('closed', 'customer'), false);
});

test('открытую гарантию заказчик закрывает', () => {
  for (const status of ['open', 'assigned', 'in_progress', 'fixed', 'review']) {
    assert.equal(
      canCloseWarranty(status, 'customer'),
      true,
      `статус ${status} должен допускать закрытие`,
    );
  }
});

test('исполнитель гарантию не закрывает ни в каком статусе', () => {
  for (const status of ['open', 'fixed', 'closed']) {
    assert.equal(canCloseWarranty(status, 'contractor'), false);
  }
});

test('неизвестный статус не открывает закрытие', () => {
  assert.equal(canCloseWarranty('нечто-неизвестное', 'customer'), false);
});

test('закрытая гарантия объясняет себя, а не молчит', () => {
  assert.equal(issueWaitingHint('closed', 'customer', true), 'Гарантия закрыта');
  assert.equal(issueWaitingHint('closed', 'contractor', true), 'Гарантию закрывает заказчик');
});

test('карточка гарантии нигде не остаётся совсем пустой', () => {
  // Пустая карточка — ни кнопки, ни подсказки — это тупик: пользователь
  // не знает ни что делать, ни почему делать нечего.
  for (const role of ['customer', 'contractor'] as const) {
    for (const status of ['open', 'assigned', 'in_progress', 'fixed', 'review', 'closed']) {
      const hasButton = canCloseWarranty(status, role);
      const hint = issueWaitingHint(status, role, true);
      assert.ok(
        hasButton || hint,
        `гарантия · ${role} · ${status}: ни действия, ни объяснения`,
      );
    }
  }
});
