import assert from 'node:assert/strict';
import {
  EDIT_WINDOW_MS,
  canEditByAge,
  canLeaveThread,
  canManageThread,
  canRemoveParticipant,
  chatMutationError,
  editedLabel,
  messageActions,
  parseChatTime,
} from './chatActions';

const now = Date.parse('2026-10-01T12:00:00Z');
const user = { id: 'u1', role: 'customer' };
const ctx = { canPin: true, canWrite: true };
const msg = (over: Record<string, unknown> = {}) => ({
  author_id: 'u1',
  author_role: 'customer',
  message_type: 'text',
  created_at: '2026-10-01T11:00:00',
  ...over,
});

// возраст: серверное время без зоны читается как UTC
assert.equal(parseChatTime('2026-10-01T11:00:00'), Date.parse('2026-10-01T11:00:00Z'));
assert.equal(parseChatTime('2026-10-01T11:00:00+03:00'), Date.parse('2026-10-01T08:00:00Z'));
assert.equal(parseChatTime('мусор'), null);
assert.equal(canEditByAge('2026-10-01T11:00:00', now), true);
assert.equal(canEditByAge(new Date(now - EDIT_WINDOW_MS).toISOString(), now), true);
assert.equal(canEditByAge(new Date(now - EDIT_WINDOW_MS - 1000).toISOString(), now), false);
assert.equal(canEditByAge('не дата', now), false);

// своё текстовое свежее: всё доступно
assert.deepEqual(messageActions(msg(), user, ctx, now), { reply: true, pin: true, edit: true, remove: true });
// старше суток: правки нет, удаление остаётся
assert.deepEqual(
  messageActions(msg({ created_at: '2026-09-29T11:00:00' }), user, ctx, now),
  { reply: true, pin: true, edit: false, remove: true },
);
// чужое: только ответить/закрепить
assert.deepEqual(
  messageActions(msg({ author_id: 'u2' }), user, ctx, now),
  { reply: true, pin: true, edit: false, remove: false },
);
// не текст — нельзя править, можно удалить
assert.equal(messageActions(msg({ message_type: 'photo' }), user, ctx, now).edit, false);
assert.equal(messageActions(msg({ message_type: 'photo' }), user, ctx, now).remove, true);
// закрепление зависит от права на тред
assert.equal(messageActions(msg(), user, { canPin: false }, now).pin, false);
// только чтение: ничего не меняет
assert.deepEqual(
  messageActions(msg(), user, { canPin: false, canWrite: false }, now),
  { reply: false, pin: false, edit: false, remove: false },
);
// удалённое и системное — без действий
const none = { reply: false, pin: false, edit: false, remove: false };
assert.deepEqual(messageActions(msg({ deleted: true }), user, ctx, now), none);
assert.deepEqual(messageActions(msg({ author_role: 'system', message_type: 'system' }), user, ctx, now), none);
// старый backend без author_id: «моё» по роли
assert.equal(messageActions(msg({ author_id: null }), user, ctx, now).remove, true);
assert.equal(messageActions(msg({ author_id: null, author_role: 'contractor' }), user, ctx, now).remove, false);

// подпись «изменено»
assert.equal(editedLabel({ edited_at: '2026-10-01T11:30:00' }), 'изменено');
assert.equal(editedLabel({ edited_at: null }), null);
assert.equal(editedLabel({}), null);
assert.equal(editedLabel({ edited_at: '2026-10-01T11:30:00', deleted: true }), null);

// управление тредом
const sys = { author_id: 'u9', author_role: 'system', message_type: 'system' };
assert.equal(canManageThread({ id: 'u1' }, [{ user_id: 'u1', role: 'customer', status: 'active' }], []), true);
assert.equal(canManageThread({ id: 'u9' }, [{ user_id: 'u1', role: 'customer', status: 'active' }], [sys]), true);
assert.equal(canManageThread({ id: 'u2' }, [{ user_id: 'u1', role: 'customer', status: 'active' }], [sys]), false);
assert.equal(canManageThread({ id: 'u2' }, undefined, []), false);

// выход и удаление участника
const parts = [
  { user_id: 'u1', role: 'customer', status: 'active' },
  { user_id: 'u3', role: 'invited', status: 'active' },
  { user_id: 'u4', role: 'invited', status: 'removed' },
];
assert.equal(canLeaveThread({ id: 'u3' }, parts), true);
assert.equal(canLeaveThread({ id: 'u1' }, parts), false);
assert.equal(canLeaveThread({ id: 'u4' }, parts), false);
assert.equal(canRemoveParticipant(true, { id: 'u1' }, parts[1]), true);
assert.equal(canRemoveParticipant(true, { id: 'u1' }, parts[0]), false);
assert.equal(canRemoveParticipant(false, { id: 'u1' }, parts[1]), false);
assert.equal(canRemoveParticipant(true, { id: 'u3' }, parts[1]), false);
assert.equal(canRemoveParticipant(true, { id: 'u1' }, parts[2]), false);

// тексты ошибок
assert.match(chatMutationError({ message: 'edit_window_expired', status: 409 }) ?? '', /суток/);
assert.match(chatMutationError({ message: 'x', status: 403 }) ?? '', /прав/);
assert.match(chatMutationError({ message: 'x', status: 409 }) ?? '', /изменились/);
assert.match(chatMutationError({ message: 'x', status: 422 }) ?? '', /данные/);
assert.equal(chatMutationError({ message: 'x', status: 500 }), null);
assert.equal(chatMutationError(null), null);
console.log('chatActions ok');
