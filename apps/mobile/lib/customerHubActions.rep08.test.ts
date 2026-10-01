/** REP-08: гарантийные действия заказчика и «в спор» живут в хабе приёмки (для заказчика /quality-control ремапится в него). */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { warrantyActions } from './domain/issueLifecycle';

const mobile = join(__dirname, '..');
const hub = readFileSync(join(mobile, 'components/screens/control/CustomerControlView.tsx'), 'utf8');
const push = readFileSync(join(mobile, 'lib/pushLinks.ts'), 'utf8');

assert.ok(/canonicalPath === '\/quality-control' && role === 'customer'[\s\S]{0,400}repairTabRoute\(role, 'control'\)/.test(push), 'ремап QC -> хаб для заказчика (причина, по которой действия обязаны быть в хабе)');
for (const needle of ['warrantyActions(w.status', 'api.closeWarrantyClaim', 'api.reopenWarrantyClaim', 'api.respondWarrantyClaim', 'api.escalateIssue', 'title="В спор"', 'WarrantyTextModal']) {
  assert.ok(hub.includes(needle), `хаб: нет ${needle}`);
}
assert.ok(!hub.includes('openQcIssue'), 'строка гарантии больше не ведёт по кругу обратно в хаб');
assert.deepEqual(warrantyActions('fixed', 'customer').map((a) => a.kind), ['close', 'reopen']);
assert.deepEqual(warrantyActions('closed', 'customer').map((a) => a.kind), ['reopen']);
console.log('customerHubActions.rep08.test OK');
