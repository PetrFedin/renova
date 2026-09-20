/**
 * Приложение ветвится по `contractor_id`, поэтому поле должно приходить.
 *
 * Найдено проходом демо как клиент: объект создан из заявки, исполнитель
 * закреплён, а «Комнаты» показывают «Исполнитель не подключён» и разрешают
 * заказчику править комнаты напрямую — при том, что на том же экране написано
 * «После подключения изменения только через запрос».
 *
 * Причина серверная: `ProjectOut` не отдавал `contractor_id`. Этот тест держит
 * клиентскую сторону — перечень мест, которые от поля зависят, чтобы правку
 * нельзя было откатить незаметно.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const ROOT = new URL('../../', import.meta.url).pathname;
const types = readFileSync(`${ROOT}lib/api/types/project.ts`, 'utf8');
const rooms = readFileSync(`${ROOT}components/screens/OsRoomsScreen.tsx`, 'utf8');
const roomDetail = readFileSync(`${ROOT}components/screens/RoomDetailScreen.tsx`, 'utf8');
const estimate = readFileSync(`${ROOT}components/screens/estimate/CustomerEstimateView.tsx`, 'utf8');
const profile = readFileSync(`${ROOT}components/screens/profile/CustomerProfileScreen.tsx`, 'utf8');

test('тип проекта объявляет поле', () => {
  assert.match(types, /contractor_id\?: string \| null;/);
});

test('от поля зависит правило «только через запрос»', () => {
  // Ровно то, что ломалось: заказчик правил комнаты напрямую на объекте,
  // где исполнитель уже ведёт работы.
  assert.match(rooms, /requestOnly=\{!!activeProject\.contractor_id\}/);
  assert.match(roomDetail, /const ownerCanEdit = !isContractor && !activeProject\?\.contractor_id/);
});

test('от поля зависит подсказка о подключении исполнителя', () => {
  assert.match(rooms, /\{!activeProject\.contractor_id && \(/);
  assert.match(rooms, /\{!activeProject\.contractor_id \? \(/);
});

test('от поля зависит фиксация сметы и профиль', () => {
  assert.match(estimate, /Boolean\(activeProject\.contractor_id\)/);
  assert.match(profile, /const hasContractor = Boolean\(activeProject\?\.contractor_id\)/);
});
