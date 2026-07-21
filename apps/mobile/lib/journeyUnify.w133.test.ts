/** W133: create work/room, stage acceptance, approvals hub, profile dates → SoT */
import { readFileSync } from 'fs';
import { join } from 'path';

const mobile = join(__dirname, '..');

const nav = readFileSync(join(mobile, 'lib/fieldCreateNav.ts'), 'utf8');
const work = readFileSync(join(mobile, 'components/renova/CreateWorkSheet.tsx'), 'utf8');
const room = readFileSync(join(mobile, 'components/renova/CreateRoomSheet.tsx'), 'utf8');
const stage = readFileSync(join(mobile, 'components/screens/stage/StageDetailHero.tsx'), 'utf8');
const profile = readFileSync(join(mobile, 'components/screens/OsProjectProfileScreen.tsx'), 'utf8');
const day = readFileSync(join(mobile, 'components/renova/schedule/ScheduleDayDetail.tsx'), 'utf8');
const approvals = readFileSync(join(mobile, 'app/approvals.tsx'), 'utf8');

console.assert(nav.includes('alertWorkCreated') && nav.includes('alertRoomCreated'), 'create alerts');
console.assert(nav.includes('alertStageSubmittedForAcceptance'), 'stage→acceptance');
console.assert(nav.includes('alertApprovalApproved') && nav.includes('alertApprovalRejected'), 'hub alerts');
console.assert(nav.includes('alertProjectProfileSaved') && nav.includes('calendarTabRoute'), 'profile→calendar');
console.assert(work.includes('alertWorkCreated'), 'work sheet wired');
console.assert(room.includes('alertRoomCreated'), 'room sheet wired');
console.assert(stage.includes('alertStageSubmittedForAcceptance'), 'stage hero wired');
console.assert(profile.includes('alertProjectProfileSaved') && profile.includes('datesChanged'), 'profile wired');
console.assert(day.includes('alertWorkOrderAdvanced'), 'day detail→WO CTA');
console.assert(approvals.includes('alertApprovalApproved') && approvals.includes('alertApprovalRejected'), 'hub wired');
console.assert(approvals.includes('alertChangeOrderApproved'), 'CO via procurementNav');
console.assert(!profile.includes("Alert.alert('Сохранено', 'Профиль объекта обновлён')"), 'profile uses shared');

console.log('journeyUnify.w133.test.ts OK');
