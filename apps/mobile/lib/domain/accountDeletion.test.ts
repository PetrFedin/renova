import { blockerLines, extractBlockers, DELETE_CONFIRM_MESSAGE } from './accountDeletion';

const must = (c: boolean, m: string) => {
  if (!c) throw new Error(m);
};

const lines = blockerLines([{ code: 'active_projects', count: 2 }, { code: 'unsettled_payments', count: 1 }, { code: 'x', count: 3 }]);
must(lines.length === 3, 'one line per blocker');
must(lines[0].includes('2') && lines[0].includes('проект'), 'active projects text');
must(lines[1].includes('платеж'), 'payments text');
must(lines[2].includes('x'), 'unknown code falls back');

const err = { status: 409, detail: { code: 'account_deletion_blocked', blockers: [{ code: 'active_projects', count: 1 }] } };
const got = extractBlockers(err);
must(got !== null && got.length === 1 && got[0].count === 1, 'extracts blockers from 409');
must(extractBlockers({ status: 500, detail: err.detail }) === null, 'non-409 ignored');
must(extractBlockers({ status: 409, detail: { code: 'other' } }) === null, 'other 409 ignored');
must(extractBlockers(null) === null, 'null safe');
must(DELETE_CONFIRM_MESSAGE.includes('нельзя отменить'), 'warns irreversible');
console.log('accountDeletion ok');
