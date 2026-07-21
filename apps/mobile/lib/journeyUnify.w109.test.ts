/** W109: selections/schedule offline, goBack resolve, works canon, inbox selections */
import { readFileSync } from 'fs';
import { join } from 'path';
import { TAB_ALIASES } from './legacyRoutes';
import { parseOsHref } from '../constants/osSections';

const root = join(__dirname, '../../..');
const mobile = join(__dirname, '..');

const selections = readFileSync(join(mobile, 'lib/api/selections.ts'), 'utf8');
const schedule = readFileSync(join(mobile, 'lib/api/workSchedule.ts'), 'utf8');
const nav = readFileSync(join(mobile, 'lib/navigation.ts'), 'utf8');
const inbox = readFileSync(join(mobile, 'lib/domain/buildInboxItems.ts'), 'utf8');
const insights = readFileSync(join(root, 'backend/app/services/ai_insights_service.py'), 'utf8');
const osApi = readFileSync(join(root, 'backend/app/api/v1/os.py'), 'utf8');

console.assert(selections.includes('offline_queued') && selections.includes('proposeSelection'), 'selections offline');
console.assert(schedule.includes('updateWorkScheduleItemStatus') && schedule.includes('offline_queued'), 'schedule item offline');
console.assert(nav.includes('replaceOsNav') && nav.includes('osRole'), 'goBack resolve via replaceOsNav');
console.assert(inbox.includes('selections-pending') && inbox.includes("repairTabHref(role, 'selections')"), 'inbox selections');
console.assert(insights.includes('repair?tab=works'), 'backend works canon');
console.assert(osApi.includes('link_path="/control"'), 'issues → /control');
console.assert(!insights.includes('(tabs)/works"'), 'no bare works');

const works = parseOsHref(TAB_ALIASES['/(customer)/(tabs)/works']!);
console.assert(works.params?.tab === 'works', 'works alias');

console.log('journeyUnify.w109.test.ts OK');

const planUi = require('fs').readFileSync(require('path').join(__dirname, '../components/renova/schedule/SchedulePlanItems.tsx'), 'utf8');
console.assert(planUi.includes('updateWorkScheduleItemStatus') && planUi.includes('notifyOfflineQueued'), 'SchedulePlanItems UI');

