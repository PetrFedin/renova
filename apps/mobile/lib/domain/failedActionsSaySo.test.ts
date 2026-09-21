/**
 * Не удавшееся действие должно об этом сказать.
 *
 * В пяти местах обработка ошибки выглядела так:
 *
 *     catch (e) { if (isOfflineQueued(e)) notifyOfflineQueued('Согласование'); }
 *
 * При ответе 500, 403 или обрыве связи не происходило ничего: ни сообщения,
 * ни записи в отчёт, ни обновления списка. Окно подтверждения закрывалось, и
 * человек считал, что решение принято.
 *
 * Проверено на живом приложении: подменённый ответ сервера (500 с телом
 * «Временный сбой сервера») на нажатие «Согласовать» раньше не давал на
 * экране ничего, после правки показывает «Согласование: не удалось —
 * Временный сбой сервера».
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const ROOT = new URL('../../', import.meta.url).pathname;
const helper = readFileSync(`${ROOT}lib/mutationFailure.ts`, 'utf8');
const SOURCES: [string, string][] = [
  ['согласования', readFileSync(`${ROOT}app/approvals.tsx`, 'utf8')],
  ['список чатов', readFileSync(`${ROOT}components/renova/chat/ChatListView.tsx`, 'utf8')],
  ['мебель на плане', readFileSync(`${ROOT}components/renova/FurnitureLayer.tsx`, 'utf8')],
];

test('офлайн остаётся очередью, а не ошибкой', () => {
  // Действие встало в очередь — это не сбой, и пугать им нельзя.
  assert.match(helper, /if \(isOfflineQueued\(error\)\) \{/);
  assert.match(helper, /notifyOfflineQueued\(options\.action\);/);
  assert.match(helper, /return 'queued';/);
});

test('всё остальное объясняется и записывается', () => {
  assert.match(helper, /reportError\(options\.scope, error, options\.context\);/);
  assert.match(helper, /showActionConfirm\(\{/);
  assert.match(helper, /\$\{options\.action\}: не удалось/);
});

test('сообщение сервера доходит до человека', () => {
  assert.match(helper, /error instanceof Error && error\.message/);
  assert.match(helper, /Проверьте связь и повторите\./);
});

for (const [name, source] of SOURCES) {
  test(`${name}: молчаливого обработчика не осталось`, () => {
    assert.ok(
      !/catch \(\w+\) \{\s*\n\s*if \(isOfflineQueued\([^)]*\)\)[^\n]*\n\s*\}/.test(source),
      `${name}: ошибка снова проглатывается`,
    );
    assert.match(source, /explainMutationFailure\(/, `${name} не зовёт общий обработчик`);
  });
}

test('у каждого места своя метка для отчёта', () => {
  const scopes = SOURCES.flatMap(([, source]) =>
    [...source.matchAll(/scope: '([^']+)'/g)].map((m) => m[1]),
  );
  assert.deepEqual(
    [...scopes].sort(),
    ['approvals.approve', 'approvals.reject', 'chatList.archive', 'chatList.pin', 'floorPlan.moveFurniture'],
  );
});

test('несохранённая расстановка мебели не остаётся на экране', () => {
  // Иначе человек видит расположение, которого на сервере нет.
  const furniture = SOURCES[2][1];
  const block = furniture.slice(furniture.indexOf('scope: \'floorPlan.moveFurniture\''));
  assert.match(block, /load\(\);/);
});
