/** W130: job leads / stage start / team / WO → SoT CTAs */
import { readFileSync } from 'fs';
import { join } from 'path';

const mobile = join(__dirname, '..');

const nav = readFileSync(join(mobile, 'lib/jobLeadNav.ts'), 'utf8');
const leads = readFileSync(join(mobile, 'components/renova/JobLeadsBoard.tsx'), 'utf8');
const stage = readFileSync(join(mobile, 'components/screens/stage/StageDetailHero.tsx'), 'utf8');
const wo = readFileSync(join(mobile, 'components/screens/WorkOrderDetailScreen.tsx'), 'utf8');
const team = readFileSync(join(mobile, 'app/(contractor)/_screens/team-qr.tsx'), 'utf8');

console.assert(nav.includes('alertJobLeadCreated') && nav.includes('alertJobLeadQuoted'), 'leads alerts');
console.assert(nav.includes('alertStageStarted') && nav.includes('calendarTabRoute'), 'stage→calendar');
console.assert(nav.includes('alertTeamJoined') && nav.includes('alertWorkOrderAdvanced'), 'team+WO');
console.assert(leads.includes('alertJobLeadCreated') && leads.includes('alertJobLeadQuoted'), 'board wired');
console.assert(leads.includes('alertJobLeadAssigned'), 'auto-assign CTA');
console.assert(stage.includes('alertStageStarted'), 'stage start CTA');
console.assert(wo.includes('alertWorkOrderAdvanced'), 'WO transition CTA');
console.assert(team.includes('alertTeamJoined'), 'team join CTA');

console.log('journeyUnify.w130.test.ts OK');
