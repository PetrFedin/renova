/** W149: control UI offline + honesty; osTypes includes IssueFixed */
import { readFileSync } from 'fs';
import { join } from 'path';

function must(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const root = join(__dirname, '..');
const contr = readFileSync(join(root, 'components/screens/control/ContractorControlView.tsx'), 'utf8');
const cust = readFileSync(join(root, 'components/screens/control/CustomerControlView.tsx'), 'utf8');
const types = readFileSync(join(root, 'lib/domain/osTypes.ts'), 'utf8');

must(types.includes("IssueFixed"), 'osTypes IssueFixed');
must(contr.includes('isOfflineQueued') && contr.includes('Исправлено'), 'contractor offline+fixed');
must(contr.includes('заказчик получит уведомление'), 'contractor honesty alert');
must(cust.includes('isOfflineQueued') && cust.includes('Подтвердить исправление'), 'customer offline+confirm');

console.log('issueFixedNotify.w149.test.ts OK');
