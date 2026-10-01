import assert from 'node:assert/strict';
import {
  canEditMember,
  canonicalInvitePhone,
  qrScreenMode,
  resolveInviteRole,
  resolveTeamView,
  teamErrorMessage,
  teamRoleLabel,
} from './teamsUi';

// MKT-037: один номер в разных форматах -> один канонический вид
for (const raw of ['+7 999 123-45-67', '8 (999) 123 45 67', '9991234567', '+79991234567']) {
  assert.equal(canonicalInvitePhone(raw), '+79991234567', raw);
}
assert.equal(canonicalInvitePhone('abc'), null);
assert.equal(canonicalInvitePhone(''), null);
assert.equal(canonicalInvitePhone('123'), null);

// MKT-023: роль приглашения — только из списка, owner недопустим
assert.equal(resolveInviteRole('foreman'), 'foreman');
assert.equal(resolveInviteRole('viewer'), 'viewer');
assert.equal(resolveInviteRole('owner'), 'member');
assert.equal(resolveInviteRole(undefined), 'member');
assert.equal(teamRoleLabel('owner'), 'Владелец');

// MKT-035: «команды нет» и «не удалось загрузить» различаются
assert.deepEqual(resolveTeamView(null), { state: 'loading' });
assert.deepEqual(resolveTeamView({ kind: 'failed' }), { state: 'error' });
assert.deepEqual(resolveTeamView({ kind: 'loaded', team: null }), { state: 'none' });
const team = { id: 't', owner_id: 'u1', members: [{ user_id: 'u1', role: 'owner' }, { user_id: 'u2', role: 'member' }] };
assert.equal(resolveTeamView({ kind: 'loaded', team }).state, 'ready');
// сбой обновления не стирает уже загруженную команду
assert.deepEqual(resolveTeamView({ kind: 'failed' }, team), { state: 'ready', team });

// MKT-021: режим экрана QR; «создать» предлагаем только при подтверждённом отсутствии команды
assert.equal(qrScreenMode({ state: 'loading' }, 'u1'), 'loading');
assert.equal(qrScreenMode({ state: 'error' }, 'u1'), 'error');
assert.equal(qrScreenMode({ state: 'none' }, 'u1'), 'no-team');
assert.equal(qrScreenMode({ state: 'ready', team }, 'u1'), 'owner');
assert.equal(qrScreenMode({ state: 'ready', team }, 'u2'), 'member');

// кого владелец может редактировать
assert.equal(canEditMember(team, 'u1', team.members[1]), true);
assert.equal(canEditMember(team, 'u1', team.members[0]), false);
assert.equal(canEditMember(team, 'u2', team.members[1]), false);
assert.equal(canEditMember(null, 'u1', team.members[1]), false);

// MKT-013: понятные тексты по кодам сервера
assert.equal(teamErrorMessage({ code: 'already_member', message: 'Ошибка сервера (HTTP 409). Попробуйте позже.' }), 'Этот исполнитель уже в бригаде');
assert.equal(teamErrorMessage({ code: 'invalid_phone' }), 'Проверьте номер телефона');
assert.equal(teamErrorMessage({ message: 'Сеть недоступна' }), 'Сеть недоступна');
assert.equal(teamErrorMessage({ message: 'Ошибка сервера (HTTP 500). Попробуйте позже.' }, 'Не удалось'), 'Не удалось');

console.log('teamsUi.test OK');
