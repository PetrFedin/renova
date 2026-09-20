/**
 * Экран входа не подставляет чужой номер и не показывает JSON.
 *
 * Найдено проходом сценария регистрации организации по SMS на живом
 * приложении:
 *
 * 1. Поле телефона было предзаполнено «+79001234567» — не подсказкой, а
 *    значением. Ввод дописывался к нему, и на сервер ушло
 *    «+79001234567+79001112233».
 * 2. В ответ пришла ошибка проверки полей, и приложение показало её как есть:
 *    `{"detail":[{"type":"string_too_long","loc":["body","phone"], …}]}`
 *    — в диалоге «Ошибка входа», на первом экране приложения.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { isHumanMessage, validationMessage } from '../api/validationMessage';

const ROOT = new URL('../../', import.meta.url).pathname;
const role = readFileSync(`${ROOT}app/onboarding/_screens/role.tsx`, 'utf8');
const client = readFileSync(`${ROOT}lib/api/client.ts`, 'utf8');

test('поле телефона пустое, подсказка осталась подсказкой', () => {
  assert.match(role, /const \[phone, setPhone\] = useState\(''\);/);
  assert.ok(!/useState\('\+7\d+'\)/.test(role), 'в поле снова подставлен номер');
  assert.match(role, /placeholder="Телефон \+7…"/);
});

test('тот самый ответ сервера превращается в подсказку', () => {
  const detail = [{
    type: 'string_too_long',
    loc: ['body', 'phone'],
    msg: 'String should have at most 20 characters',
    ctx: { max_length: 20 },
  }];
  assert.equal(
    validationMessage(detail),
    'Сервер не принял данные формы: «phone» — не длиннее 20 символов.',
  );
});

test('пустое поле называется пустым', () => {
  assert.equal(
    validationMessage([{ type: 'missing', loc: ['body', 'code'] }]),
    'Сервер не принял данные формы: «code» — заполните поле.',
  );
});

test('несколько полей перечисляются, остаток считается', () => {
  const many = Array.from({ length: 5 }, (_, i) => ({ type: 'missing', loc: ['body', `f${i}`] }));
  const message = validationMessage(many);
  assert.match(message!, /«f0».+«f1».+«f2»/);
  assert.match(message!, /и ещё 2\./);
});

test('незнакомое правило не ломает текст', () => {
  assert.equal(
    validationMessage([{ type: 'что-то_новое', loc: ['body', 'x'] }]),
    'Сервер не принял данные формы: «x» — значение не принято.',
  );
});

test('не-массив сюда не относится', () => {
  for (const value of [null, undefined, 'строка', {}, []]) {
    assert.equal(validationMessage(value), null);
  }
});

test('JSON и HTML не показываются человеку', () => {
  assert.ok(!isHumanMessage('{"detail":"x"}'));
  assert.ok(!isHumanMessage('[{"type":"missing"}]'));
  assert.ok(!isHumanMessage('<!doctype html><html>…'));
  assert.ok(!isHumanMessage('   '));
  assert.ok(!isHumanMessage('о'.repeat(400)));
});

test('нормальный текст от сервера по-прежнему проходит', () => {
  assert.ok(isHumanMessage('Нет доступа'));
  assert.ok(isHumanMessage('Проект не найден'));
});

test('клиент не показывает тело ответа как сообщение', () => {
  assert.match(client, /if \(isHumanMessage\(txt\)\) return \{ message: txt, code, detail \};/);
  assert.match(client, /Сервер вернул ошибку \(\$\{status\}\)\. Повторите позже\./);
});

test('исходный текст не теряется — он нужен в отчёте об ошибке', () => {
  assert.match(client, /detail: detail \?\? txt/);
});

test('прежние разборы ответа не тронуты', () => {
  // Строковый `detail`, `message` и лимит запросов разбирались и раньше.
  assert.match(client, /return \{ message: j\.detail, code: j\.detail, detail \};/);
  assert.match(client, /Слишком много запросов\. Подождите несколько секунд и повторите\./);
});
