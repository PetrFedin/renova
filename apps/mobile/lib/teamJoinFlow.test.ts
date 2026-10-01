import { parseTeamInviteToken, requireSuccessfulTeamInvite, requireSuccessfulTeamJoin, teamJoinErrorMessage } from './teamJoinFlow';

function must(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const teamId = requireSuccessfulTeamJoin({ ok: true, team_id: 'team-1' });
must(teamId === 'team-1', 'confirmed join must return the committed team id');

for (const bad of [
  { value: { ok: false, message: 'Ссылка недействительна' }, expected: 'Ссылка недействительна' },
  { value: { ok: false }, expected: 'Не удалось присоединиться к бригаде' },
  { value: { ok: true }, expected: 'Сервер не подтвердил бригаду' },
  { value: null, expected: 'Сервер не подтвердил вступление в бригаду' },
]) {
  let message = '';
  try {
    requireSuccessfulTeamJoin(bad.value);
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  must(message === bad.expected, `join failure must stay truthful: expected ${bad.expected}, got ${message}`);
}

must(parseTeamInviteToken('renova://team/join/AbCdEf123456_-xy') === 'AbCdEf123456_-xy', 'deep link token');
must(parseTeamInviteToken('https://renova.app/team/join/AbCdEf123456?x=1') === 'AbCdEf123456', 'https link token');
must(parseTeamInviteToken('https://example.com/other') === null, 'foreign QR is not an invite');
must(parseTeamInviteToken('') === null && parseTeamInviteToken(null) === null, 'empty is not an invite');
must(teamJoinErrorMessage(new Error('Ссылка недействительна')) === 'Ссылка недействительна', 'server text must be shown');
must(teamJoinErrorMessage(undefined) === 'Не удалось присоединиться к бригаде', 'fallback text');

requireSuccessfulTeamInvite({ ok: true });
for (const bad of [{ ok: false, message: 'Уже в бригаде' }, { ok: false }, null]) {
  let message = '';
  try {
    requireSuccessfulTeamInvite(bad);
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  must(message.length > 0, 'ok:false invite must not be reported as sent');
}

console.log('teamJoinFlow.test OK');
