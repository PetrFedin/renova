/**
 * Отмена счёта видна тому, кому она разрешена, и статус читается по-русски.
 *
 * Серверная часть — #604: `POST /projects/{id}/payments/{id}/cancel`,
 * только ожидающий счёт и только свой тип.
 *
 * До этой правки кнопки не было вовсе, а список счетов показывал сырые
 * статусы: `PAYMENT_STATUS_LABEL` знал четыре значения из семи, и строка
 * рисуется как `PAYMENT_STATUS_LABEL[status] || status`. На экране это
 * видно живьём — рядом со счётом стояло `disputed`.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { PAYMENT_STATUS_LABEL } from '../../constants/labels';

const ROOT = new URL('../../', import.meta.url).pathname;
const section = readFileSync(`${ROOT}components/screens/budget/BudgetPaymentsSection.tsx`, 'utf8');

/** Значения PaymentStatus из backend/app/models/entities.py. */
const SERVER_STATUSES = [
  'pending', 'processing', 'paid_unverified',
  'confirmed', 'cancelled', 'disputed', 'refunded',
];
const LATIN = /[a-z]/i;

test('каждый статус счёта с сервера читается по-русски', () => {
  for (const status of SERVER_STATUSES) {
    const label = PAYMENT_STATUS_LABEL[status];
    assert.ok(label, `${status}: подписи нет — статус уйдёт на экран как есть`);
    assert.ok(!LATIN.test(label), `${status}: показывается как «${label}»`);
  }
});

test('именно «disputed» больше не попадает на экран', () => {
  // Ровно то, что было видно в списке счетов.
  assert.equal(PAYMENT_STATUS_LABEL.disputed, 'Спор');
});

test('новый статус отмены тоже назван', () => {
  assert.equal(PAYMENT_STATUS_LABEL.cancelled, 'Отменён');
});

test('прежние подписи не изменились', () => {
  assert.equal(PAYMENT_STATUS_LABEL.pending, 'Ожидает оплаты');
  assert.equal(PAYMENT_STATUS_LABEL.confirmed, 'Оплачено');
  assert.equal(PAYMENT_STATUS_LABEL.paid_unverified, 'Оплачено без чека');
});

test('отменить можно только ожидающий счёт', () => {
  assert.match(section, /payment\.status === 'pending' && ownPaymentType/);
});

test('кнопка показывается только тому, кто мог бы выставить такой счёт', () => {
  // Иначе она обещала бы то, в чём сервер откажет.
  assert.match(section, /role === 'customer'/);
  assert.match(section, /payment\.payment_type === 'advance' \|\| payment\.payment_type === 'final'/);
  assert.match(section, /payment\.payment_type === 'stage' \|\| payment\.payment_type === 'material'/);
});

test('деньги подтверждаются до действия, а не после', () => {
  assert.match(section, /title: 'Отменить счёт\?'/);
  assert.match(section, /formatRub\(payment\.amount\)/);
  assert.match(section, /secondaryLabel: 'Оставить'/);
});

test('подтверждение не обещает возврата денег', () => {
  // Отмена снимает ожидание, а не возвращает перевод.
  assert.match(section, /Отмена не возвращает деньги/);
});

test('неудача отмены не молчит', () => {
  assert.match(section, /Не удалось отменить счёт/);
  assert.match(section, /reportError\('BudgetPaymentsSection\.cancel'/);
});

test('прежние действия со счётом сохранены', () => {
  assert.match(section, /Я перевёл — приложить подтверждение/);
  assert.match(section, /onPress=\{\(\) => onPaymentPress\(payment\)\}/);
});
