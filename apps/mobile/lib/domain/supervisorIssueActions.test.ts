import { isWarrantyIssue, supervisorIssueActions, validateSupervisorRemark } from './supervisorIssueActions';

let ok = true;
function assert(cond: boolean, msg: string) {
  if (!cond) { console.error('FAIL', msg); ok = false; }
}

const caps = ['project_read', 'communication', 'quality_issue_write', 'quality_review', 'schedule_review'];
const sup = { isSupervisor: true, capabilities: caps };
const targets = (status: string, title = 'Трещина') => supervisorIssueActions({ status, title }, sup).map((a) => a.target).join(',');

assert(targets('fixed') === 'closed,open', 'fixed: close or return');
assert(targets('review') === 'closed,open', 'review: close or return');
assert(targets('closed') === 'open', 'closed: reopen');
assert(targets('open') === '', 'open: executor works, no supervisor action');
assert(targets('in_progress') === '', 'in progress: none');
assert(targets('assigned') === '', 'assigned: none');
assert(targets('rejected') === '', 'rejected: none');
assert(targets('fixed', '[Гарантия] течь') === '', 'warranty goes through its own flow');
assert(isWarrantyIssue({ title: '[Гарантия] x' }) && !isWarrantyIssue({ title: 'x' }), 'warranty detection');

assert(supervisorIssueActions({ status: 'fixed' }, { isSupervisor: false, capabilities: caps }).length === 0, 'not the assigned supervisor');
assert(supervisorIssueActions({ status: 'fixed' }, { isSupervisor: true, capabilities: ['project_read'] }).length === 0, 'no quality_review capability');
assert(supervisorIssueActions({ status: 'fixed' }, sup).every((a) => a.confirmTitle && a.label), 'actions carry texts');

assert(!validateSupervisorRemark({ stageId: null, description: 'Трещина' }).ok, 'stage required');
assert(!validateSupervisorRemark({ stageId: 's1', description: '  ' }).ok, 'description required');
const good = validateSupervisorRemark({ stageId: 's1', description: ' Трещина в стяжке ' });
assert(good.ok && good.description === 'Трещина в стяжке', 'valid remark trimmed');

if (!ok) process.exit(1);
console.log('supervisorIssueActions tests passed');
