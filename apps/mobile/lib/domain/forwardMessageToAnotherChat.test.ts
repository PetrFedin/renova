/**
 * Пересылка сообщения в другую ветку объекта.
 *
 * Возможности не было ни на сервере, ни в клиенте: сообщение знало про ответ
 * (`reply_to_id`) и ничего не знало про пересылку. Без неё «покажи это
 * прорабу» делается скриншотом в стороннем мессенджере — и переписка по
 * объекту уходит туда, где её никто не увидит.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const ROOT = new URL('../../', import.meta.url).pathname;
const view = readFileSync(`${ROOT}components/renova/chat/ChatThreadView.tsx`, 'utf8');
const client = readFileSync(`${ROOT}lib/api/chats.ts`, 'utf8');
const types = readFileSync(`${ROOT}lib/api/types/chat.ts`, 'utf8');
/** Перенос строки в JSX не меняет текста для пользователя. */
const viewText = view.replace(/\s+/g, ' ');

test('у пересылки есть подписанная иконка рядом с остальными действиями', () => {
  assert.match(view, /icon="arrow-redo-outline"/);
  assert.match(viewText, /label="Переслать в другой чат"/);
});

test('клиент умеет переслать', () => {
  assert.match(client, /forwardChatMessage: async \(/);
  assert.match(client, /\/messages\/\$\{messageId\}\/forward/);
});

test('пересылка переживает офлайн', () => {
  // Как и остальные действия в чате: отказ сети не теряет намерение.
  assert.match(client, /await enqueue\(\{ path, method: 'POST', body, userId \}\);/);
  assert.match(view, /notifyOfflineQueued\('Пересылка'\)/);
});

test('выбор ветки объясняет, что произойдёт', () => {
  assert.match(viewText, /Переслать в другой чат/);
  assert.match(viewText, /Копия уйдёт в выбранную ветку этого объекта/);
  assert.match(viewText, /Исходное сообщение останется на месте/);
});

test('текущая ветка из списка исключена', () => {
  // Переслать самому себе — бессмысленное действие, сервер его и не примет.
  assert.match(view, /all\.filter\(\(t\) => t\.id !== threadId\)/);
});

test('пустой список не выглядит поломкой', () => {
  assert.match(viewText, /На этом объекте других чатов нет/);
});

test('пересланное помечено происхождением', () => {
  assert.match(viewText, /↪ Переслано/);
  assert.match(view, /m\.forwarded_from\.thread_title/);
  assert.match(types, /forwarded_from\?: \{/);
});

test('неудача объясняется', () => {
  assert.match(viewText, /Не переслано/);
  assert.match(view, /reportError\('ChatThreadView\.Forward\.Mutation'/);
});

test('успех говорит, куда именно ушло', () => {
  assert.match(viewText, /Копия в «\$\{target\.title \|\| 'чате объекта'\}»/);
});

test('пересылка доступна только тому, кто может писать', () => {
  assert.match(view, /onForward=\{canWrite \? \(\) => \{ void openForward\(m\); \} : undefined\}/);
});
