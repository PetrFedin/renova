/** W124: ICS export/share + honesty + calendar SoT CTAs (Fieldwire/Houzz-style) */
import { readFileSync } from 'fs';
import { join } from 'path';

const mobile = join(__dirname, '..');

const exportFile = readFileSync(join(mobile, 'lib/exportIcalFile.ts'), 'utf8');
const calApi = readFileSync(join(mobile, 'lib/api/calendar.ts'), 'utf8');
const nav = readFileSync(join(mobile, 'lib/calendarIcsNav.ts'), 'utf8');
const toolbar = readFileSync(join(mobile, 'components/renova/schedule/ScheduleIconToolbar.tsx'), 'utf8');
const icalBtn = readFileSync(join(mobile, 'components/renova/IcalImportButton.tsx'), 'utf8');
const docs = readFileSync(join(mobile, 'components/renova/DocumentsHub.tsx'), 'utf8');
const push = readFileSync(join(mobile, 'lib/pushLinks.ts'), 'utf8');

console.assert(exportFile.includes('Sharing.shareAsync') && exportFile.includes('text/calendar'), 'native ICS share');
console.assert(calApi.includes('exportIcalFile'), 'calendar API → exportIcalFile');
console.assert(nav.includes('ICS_SYNC_HONESTY') && nav.includes('alertIcalExported') && nav.includes('calendarTabRoute'), 'ics nav SoT');
console.assert(toolbar.includes('exportIcal') && toolbar.includes('cloud-download-outline') && toolbar.includes('ICS_SYNC_HONESTY'), 'toolbar export+honesty');
console.assert(toolbar.includes('alertIcalImported') && toolbar.includes('syncProjectSideEffects'), 'toolbar import→bus');
console.assert(icalBtn.includes('alertIcalImported'), 'IcalImportButton CTA');
console.assert(docs.includes('alertIcalExported') && docs.includes('calendarTabRoute'), 'docs ICS→calendar CTA');
console.assert(push.includes("case 'waste_reminder'") && push.includes("repairTabRoute(role, 'materials')"), 'waste→materials');
console.assert(push.includes("case 'deadline'") && push.includes("tabsRoute(role, 'calendar')"), 'deadline→calendar');

console.log('journeyUnify.w124.test.ts OK');
