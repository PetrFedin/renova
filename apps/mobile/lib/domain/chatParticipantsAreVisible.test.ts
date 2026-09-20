/**
 * «Кто видит этот чат» — вопрос про приватность, а не украшение настроек.
 *
 * Найдено обходом живого приложения: в чате, где переписываются заказчик и
 * исполнитель, «Настройки чата» не показывали ни одного участника. Блок
 * отрисовывается при `chat.participants.length > 0`, а сервер возвращал только
 * приглашённых — то есть пустой список.
 *
 * На живом проекте после правки сервер отдаёт троих: заказчика, исполнителя и
 * наблюдателя. Наблюдателя заказчик в этом чате не видел вовсе.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const ROOT = new URL('../../', import.meta.url).pathname;
const view = readFileSync(`${ROOT}components/renova/chat/ChatThreadView.tsx`, 'utf8');
const types = readFileSync(`${ROOT}lib/api/types/chat.ts`, 'utf8');
/** Перенос строки в JSX не меняет текста для пользователя. */
const viewText = view.replace(/\s+/g, ' ');

test('список подписан вопросом, на который отвечает', () => {
  assert.match(viewText, /Кто видит этот чат/);
});

test('у каждого видно, откуда у него доступ', () => {
  assert.match(view, /p\.role_label \? ` · \$\{p\.role_label\}` : ''/);
  assert.match(types, /role_label\?: string \| null;/);
  assert.match(types, /source\?: 'project' \| 'team' \| 'guest' \| 'supervision' \| 'invite';/);
});

test('источник доступа объяснён словами', () => {
  assert.match(viewText, /роль на объекте и приглашение именно в этот чат/);
});

test('прежние поля строки остались', () => {
  // Экран рисует имя, телефон или код профиля — порядок не изменился.
  assert.match(view, /p\.full_name \|\| p\.phone \|\| p\.profile_code \|\| 'Участник'/);
  assert.match(view, /p\.status === 'active' \? '' : ` · \$\{p\.status\}`/);
});

test('блок по-прежнему прячется, когда показывать нечего', () => {
  assert.match(view, /chat\.participants && chat\.participants\.length > 0 && \(/);
});
