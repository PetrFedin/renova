/**
 * Шапка закреплённых сообщений.
 *
 * Сервер отдаёт закреплённые отдельным списком и больше не переставляет их
 * в истории. Проверяется то, что легко сломать незаметно: порядок, запасной
 * путь на время выката и то, что вложение без текста не даёт пустую строку.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { pinnedEntries, pinnedLabel, pinnedPreview } from './pinnedMessages';

test('свежее закрепление показывается первым', () => {
  const entries = pinnedEntries(
    [
      { id: 'b', text: 'Новое важное' },
      { id: 'a', text: 'Старое важное' },
    ],
    [],
  );
  assert.deepEqual(entries.map((e) => e.id), ['b', 'a']);
});

test('без списка от сервера берём закреплённые из истории, свежие первыми', () => {
  // Постепенный выкат: старый сервер поля ещё не отдаёт, а закрепления есть.
  const entries = pinnedEntries(undefined, [
    { id: 'm1', text: 'Первое', is_pinned: true },
    { id: 'm2', text: 'Обычное' },
    { id: 'm3', text: 'Последнее', is_pinned: true },
  ]);
  assert.deepEqual(entries.map((e) => e.id), ['m3', 'm1']);
});

test('история не подменяет непустой список сервера', () => {
  const entries = pinnedEntries(
    [{ id: 'server', text: 'От сервера' }],
    [{ id: 'local', text: 'Из истории', is_pinned: true }],
  );
  assert.deepEqual(entries.map((e) => e.id), ['server']);
});

test('одно сообщение не дублируется', () => {
  const entries = pinnedEntries(
    [
      { id: 'same', text: 'Раз' },
      { id: 'same', text: 'Раз' },
    ],
    [],
  );
  assert.equal(entries.length, 1);
});

test('вложение без текста не даёт пустую строку', () => {
  assert.equal(pinnedPreview({ id: '1', message_type: 'photo' }), 'Фото');
  assert.equal(pinnedPreview({ id: '2', message_type: 'file', file_name: 'смета.pdf' }), 'смета.pdf');
  assert.equal(pinnedPreview({ id: '3', message_type: 'payment' }), 'Счёт');
  assert.equal(pinnedPreview({ id: '4' }), 'Сообщение');
});

test('длинный текст сворачивается в одну строку', () => {
  const preview = pinnedPreview({ id: '1', text: `Первая строка\n\nвторая   строка ${'я'.repeat(200)}` });
  assert.ok(!preview.includes('\n'), 'перенос строки ломает шапку');
  assert.ok(preview.length <= 80, `слишком длинно: ${preview.length}`);
  assert.ok(preview.endsWith('…'), 'обрезка должна быть видна');
});

test('счётчик появляется только когда закреплений больше одного', () => {
  assert.equal(pinnedLabel(1), 'Закреплено');
  assert.equal(pinnedLabel(3), 'Закреплено · 3');
});

test('пустая шапка не рисуется', () => {
  assert.deepEqual(pinnedEntries(undefined, [{ id: 'm', text: 'Обычное' }]), []);
  assert.deepEqual(pinnedEntries([], []), []);
});
