import { contractorCanMarkFixed, controlSummary, customerIssueActions, customerIssueWaitingHint } from './issueControlActions';

const keys = (status: string, self: boolean) => customerIssueActions(status, self).map((a) => a.key).join(',');

// REP-07: «Закрыть» только там, где сервер не отклонит
console.assert(keys('open', false) === '', 'open: customer has no close');
console.assert(keys('in_progress', false) === '', 'in_progress: customer has no close');
console.assert(keys('fixed', false) === 'confirm,reopen', 'fixed: confirm or send back');
console.assert(keys('review', false) === 'confirm,reopen', 'review: confirm or send back');
console.assert(keys('closed', false) === '', 'closed: nothing');
console.assert(keys('open', true) === 'close', 'self-managed customer may close an open issue');
console.assert(keys('fixed', true) === 'confirm,reopen', 'self-managed fixed still confirm');
console.assert(customerIssueActions('fixed', false)[1].next === 'open', 'send back = open');

console.assert(customerIssueWaitingHint('open', false) !== null, 'customer is told to wait');
console.assert(customerIssueWaitingHint('fixed', false) === null, 'no hint when customer can act');

// «Исправлено» не на review и не на гарантии
console.assert(contractorCanMarkFixed('open', 'Трещина') === true, 'open → fixed');
console.assert(contractorCanMarkFixed('review', 'Трещина') === false, 'review → fixed is rejected by server');
console.assert(contractorCanMarkFixed('fixed', 'Трещина') === false, 'already fixed');
console.assert(contractorCanMarkFixed('open', '[Гарантия] Течь') === false, 'warranty has its own flow');

// REP-19: одинаковая сводка у обеих ролей, закрытые не считаются
const s = controlSummary(
  [
    { status: 'open', severity: 'high' },
    { status: 'closed', severity: 'critical' },
    { status: 'fixed', severity: 'low' },
  ],
  2,
);
console.assert(s.openIssues === 2 && s.criticalOpen === 1 && s.pendingAcceptance === 2, 'summary counts open only');
