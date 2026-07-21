/** W132: schedule confirm/reject + closeout + e-sign → SoT CTAs */
import { readFileSync } from 'fs';
import { join } from 'path';

const mobile = join(__dirname, '..');

const nav = readFileSync(join(mobile, 'lib/scheduleCloseoutNav.ts'), 'utf8');
const sched = readFileSync(join(mobile, 'components/screens/schedule/UnifiedScheduleView.tsx'), 'utf8');
const docs = readFileSync(join(mobile, 'components/renova/DocumentsHub.tsx'), 'utf8');

console.assert(nav.includes('alertScheduleSubmitted') && nav.includes('alertScheduleConfirmed'), 'schedule alerts');
console.assert(nav.includes('alertScheduleRejected') && nav.includes('alertCloseoutDone'), 'reject+closeout');
console.assert(nav.includes('alertDocumentSigned') && nav.includes('calendarTabRoute'), 'sign→calendar');
console.assert(sched.includes('alertScheduleSubmitted') && sched.includes('alertScheduleConfirmed'), 'hub submit/confirm');
console.assert(sched.includes('alertScheduleRejected'), 'hub reject');
console.assert(docs.includes('alertCloseoutDone') && docs.includes('alertDocumentSigned'), 'docs wired');
console.assert(!docs.includes("Alert.alert('Готово', res.next_action"), 'closeout uses shared alert');
console.assert(!docs.includes("Alert.alert('Подписано', 'Подпись in_app"), 'in_app uses shared alert');

console.log('journeyUnify.w132.test.ts OK');
