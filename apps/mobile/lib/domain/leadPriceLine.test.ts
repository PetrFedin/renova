/**
 * Строка цены на карточке заявки не должна показывать чужое предложение.
 *
 * Сервер больше не зеркалит поданную цену в `pre_estimate` заявки и не
 * отдаёт это поле неназначенному исполнителю. Здесь проверяется вторая
 * половина: что экран не строит цену из того, чего видеть не должен.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { leadPriceLine } from './leadPriceLine';

test('исполнитель видит своё предложение', () => {
  const line = leadPriceLine({ pre_estimate: null, quotes: [{ pre_estimate: 870000 }] }, 'contractor');
  assert.ok(line);
  assert.ok(line.startsWith('Ваше предложение'), line);
  assert.ok(line.includes('870'), line);
});

test('без своего предложения исполнителю писать нечего', () => {
  assert.equal(leadPriceLine({ pre_estimate: null, quotes: [] }, 'contractor'), null);
  assert.equal(leadPriceLine({}, 'contractor'), null);
});

test('согласованная цена подписана как согласованная, а не как «оценка»', () => {
  // «Оценка» не говорит, чья она и окончательная ли. После выбора заказчиком
  // это цена сделки, и называть её надо так.
  const line = leadPriceLine({ pre_estimate: 870000 }, 'customer');
  assert.ok(line?.startsWith('Согласовано'), String(line));
});

test('заказчику без согласованной цены строка не рисуется', () => {
  // Предложения он видит отдельным списком с кнопкой «Принять».
  assert.equal(leadPriceLine({ pre_estimate: null, quotes: [{ pre_estimate: 870000 }] }, 'customer'), null);
});

test('своё предложение важнее согласованной цены', () => {
  // Назначенный исполнитель должен видеть именно свою цифру, а она и есть
  // согласованная — но приоритет задан явно, чтобы он не зависел от порядка.
  const line = leadPriceLine(
    { pre_estimate: 870000, quotes: [{ pre_estimate: 870000 }] },
    'contractor',
  );
  assert.ok(line?.startsWith('Ваше предложение'), String(line));
});
