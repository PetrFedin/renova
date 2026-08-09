import { requireSuccessfulTeamJoin } from './teamJoinFlow';

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

console.log('teamJoinFlow.test OK');
