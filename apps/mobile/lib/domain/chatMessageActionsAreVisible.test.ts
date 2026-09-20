/**
 * Действия над сообщением должны быть видны, а не угадываться.
 *
 * Реакции, ответ, закрепление и задача из сообщения были написаны целиком —
 * и открывались только долгим нажатием на пузырь. На экране об этом не
 * сообщалось ничем: ни иконки, ни подписи. Пользователь видел переписку без
 * единого элемента управления.
 *
 * Отдельно — ответ. Сервер хранит связь в `reply_to_id`, но экран её не
 * разворачивал: от ответа оставалась строка «↩ …» внутри текста сообщения.
 *
 * Проверено на живом приложении: реакция «👍 1» появилась на сообщении,
 * закреплённое сообщение поднялось наверх с пометкой «📌 Закреплено», ответ
 * отрисовался отдельной цитатой с переходом к исходному сообщению.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { textWithoutReplyPrefix } from './chatReplyPrefix';

const ROOT = new URL('../../', import.meta.url).pathname;
const view = readFileSync(`${ROOT}components/renova/chat/ChatThreadView.tsx`, 'utf8');
/** Перенос строки в JSX не меняет текста для пользователя. */
const viewText = view.replace(/\s+/g, ' ');

test('у каждого действия есть иконка', () => {
  for (const icon of ['happy-outline', 'arrow-undo-outline', 'bookmark-outline', 'checkbox-outline']) {
    assert.match(view, new RegExp(icon), `действие без иконки: ${icon}`);
  }
});

test('каждая иконка подписана для скринридера', () => {
  for (const label of [
    'Поставить реакцию',
    'Ответить на сообщение',
    'Закрепить сообщение',
    'Открепить сообщение',
    'Создать задачу из сообщения',
  ]) {
    assert.match(viewText, new RegExp(label), `действие без подписи: ${label}`);
  }
  assert.match(view, /accessibilityRole="button"/);
});

test('долгое нажатие осталось как было', () => {
  // Привычный жест не отбираем: видимые иконки его дополняют, а не заменяют.
  assert.match(view, /onLongPress=\{\(\) => \{/);
});

test('закреплённое сообщение отличается иконкой', () => {
  assert.match(view, /icon=\{m\.is_pinned \? 'bookmark' : 'bookmark-outline'\}/);
  assert.match(view, /active=\{m\.is_pinned\}/);
});

test('недоступное действие не рисуется', () => {
  // Закрепление и задача приходят только тем, у кого есть право: иконка без
  // права была бы обещанием, которое экран не выполнит.
  assert.match(view, /\{onPin \? \(/);
  assert.match(view, /\{onTask \? \(/);
});

test('ответ разворачивается в цитату', () => {
  assert.match(view, /repliedTo=\{m\.reply_to_id \?/);
  assert.match(view, /chat\.messages\.find\(\(x\) => x\.id === m\.reply_to_id\)/);
});

test('из цитаты можно перейти к исходному сообщению', () => {
  assert.match(view, /router\.setParams\(\{ highlightId: m\.reply_to_id! \}\)/);
  assert.match(viewText, /Перейти к сообщению, на которое отвечают/);
});

test('строка «↩ …» не дублирует цитату на экране', () => {
  assert.equal(textWithoutReplyPrefix('↩ Отлично, буду…\nПроверка', true), 'Проверка');
});

test('текст сообщения не теряется вместе с префиксом', () => {
  // Сообщение, состоящее из одной строки «↩ …», не должно стать пустым.
  assert.equal(textWithoutReplyPrefix('↩ Только цитата…\n', true), '↩ Только цитата…\n');
});

test('без цитаты текст не трогают', () => {
  // В выгрузке чата, в поиске и в пуше связь `reply_to_id` не разворачивается,
  // и строка «↩ …» остаётся единственным контекстом.
  assert.equal(textWithoutReplyPrefix('↩ Контекст…\nОтвет', false), '↩ Контекст…\nОтвет');
});

test('префикс по-прежнему уходит на сервер', () => {
  assert.match(view, /const prefix = replyTo\?\.text \? `↩ \$\{replyTo\.text\.slice\(0, 40\)\}…\\n` : '';/);
});
