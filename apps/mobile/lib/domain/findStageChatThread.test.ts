/** Smoke: findStageChatThread */
import assert from 'node:assert/strict';
import { findStageChatThread } from './findStageChatThread';

const chats = [
  { id: 'g', project_id: 'p', title: 'Общий чат объекта', topic: 'general', updated_at: '', last_message: null },
  { id: 'b', project_id: 'p', title: 'Ванная: плитка', topic: 'room:bathroom', updated_at: '', last_message: null },
  { id: 'e', project_id: 'p', title: 'Оплата этапа «Электрика»', topic: 'payment', updated_at: '', last_message: null },
];

const rooms = [{ id: 'r1', room_type: 'bathroom' }];

assert.equal(
  findStageChatThread(chats, { id: 's1', name: 'Санузел', room_ids: ['r1'] }, rooms)?.id,
  'b',
  'room topic by stage rooms',
);
assert.equal(
  findStageChatThread(chats, { id: 's2', name: 'Электрика', room_ids: [] }, rooms)?.id,
  'e',
  'title match for stage name',
);
assert.equal(
  findStageChatThread(chats, { id: 's3', name: 'Покраска', room_ids: [] }, rooms)?.id,
  'g',
  'fallback general',
);

console.log('findStageChatThread.test OK');
