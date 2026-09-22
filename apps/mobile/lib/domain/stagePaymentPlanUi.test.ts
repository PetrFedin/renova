/**
 * Порядок оплаты виден, правится — и приёмка без денег не молчит.
 *
 * Серверная часть — #599: цена договора разносится по весам этапов, и есть
 * ручки `GET`/`PATCH /projects/{id}/stages/payment-plan`.
 *
 * Здесь клиентская половина. До неё:
 *
 * 1. Порядок оплаты нельзя было ни увидеть, ни поправить из приложения.
 * 2. `StageDetailPaymentBlock` при нулевой сумме не рисовал **ничего**:
 *    условие показа требовало `stagePaymentAmount > 0 &&
 *    paymentExpectedOnAccept`, и ветка `else` вела к `if (!pending) return
 *    null`. Человек принимал этап, платежа не возникало, и узнать об этом
 *    было неоткуда.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { parseAmountInput, undistributedNote } from './stagePaymentPlan';

const ROOT = new URL('../../', import.meta.url).pathname;
const panel = readFileSync(`${ROOT}components/renova/StagePaymentPlanPanel.tsx`, 'utf8');
const stageBlock = readFileSync(`${ROOT}components/screens/stage/StageDetailPaymentBlock.tsx`, 'utf8');
const budget = readFileSync(`${ROOT}components/screens/OsBudgetScreen.tsx`, 'utf8');
const stagesApi = readFileSync(`${ROOT}lib/api/stages.ts`, 'utf8');

test('запятая в сумме принимается — на телефоне её и набирают', () => {
  assert.equal(parseAmountInput('7726,89'), 7726.89);
  assert.equal(parseAmountInput('7 726,89'), 7726.89);
});

test('обычная запись работает', () => {
  assert.equal(parseAmountInput('7726.89'), 7726.89);
  assert.equal(parseAmountInput('0'), 0);
});

test('пустое поле — это ноль, а не ошибка', () => {
  // Иначе стереть сумму было бы нечем.
  assert.equal(parseAmountInput(''), 0);
});

test('мусор отвергается, а не превращается в ноль молча', () => {
  for (const raw of ['abc', '1.2.3', '-5', '1e5']) {
    assert.equal(parseAmountInput(raw), null, `принято: ${raw}`);
  }
});

test('копейки не растут из округления', () => {
  assert.equal(parseAmountInput('0.005'), 0.01);
  assert.equal(parseAmountInput('1.994'), 1.99);
});

test('нераспределённое объясняется словами, а не флагом', () => {
  const note = undistributedNote({ undistributed: 39899.97 });
  assert.ok(note && note.includes('Не разнесено'));
  assert.ok(note && note.includes('платежей не возникнет'));
});

test('перебор тоже называется', () => {
  const note = undistributedNote({ undistributed: -500 });
  assert.ok(note && note.includes('больше цены договора'));
});

test('сходящийся план молчит', () => {
  assert.equal(undistributedNote({ undistributed: 0 }), null);
  assert.equal(undistributedNote({ undistributed: 0.004 }), null);
});

test('приёмка без денег больше не молчит', () => {
  assert.match(stageBlock, /!paymentExpectedOnAccept/);
  assert.match(stageBlock, /По этому этапу оплаты не возникнет/);
});

test('прежняя подсказка про оплату сохранена', () => {
  // Проверка не должна проходить оттого, что исчезло всё.
  assert.match(stageBlock, /После приёмки: оплатить \{formatRub\(stagePaymentAmount\)\}/);
});

test('отказ загрузки не выдаётся за отсутствие оплат', () => {
  // Пустой список читался бы как «этапов нет» — это неправда.
  assert.match(panel, /Это не значит, что оплат нет/);
  assert.match(panel, /setFailed\(true\)/);
});

test('панель стоит на вкладке «Оплаты»', () => {
  assert.match(budget, /<StagePaymentPlanPanel userId=\{user\.id\} projectId=\{activeProject\.id\}/);
});

test('править может только тот, кто вправе менять объект', () => {
  assert.match(budget, /canEdit=\{canWrite && !readOnly\}/);
  assert.match(panel, /canEdit \? \(/);
});

test('поле суммы называет свой этап', () => {
  assert.match(panel, /accessibilityLabel=\{`Сумма по этапу: \$\{stage\.name\}`\}/);
});

test('поле суммы не меньше цели в 44 pt', () => {
  assert.match(panel, /minHeight: RenovaTheme\.minTouch/);
});

test('клиент умеет читать и править порядок оплаты', () => {
  assert.match(stagesApi, /getStagePaymentPlan:/);
  assert.match(stagesApi, /updateStagePaymentPlan:/);
  assert.match(stagesApi, /method: 'PATCH', body: JSON\.stringify\(\{ amounts \}\)/);
});
