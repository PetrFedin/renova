/** W106: field offline queue + accept hero → stage */
import { readFileSync } from 'fs';
import { join } from 'path';

const mobile = join(__dirname, '..');
const stages = readFileSync(join(mobile, 'lib/api/stages.ts'), 'utf8');
const estimate = readFileSync(join(mobile, 'lib/api/estimate.ts'), 'utf8');
const schedule = readFileSync(join(mobile, 'lib/api/workSchedule.ts'), 'utf8');
const materials = readFileSync(join(mobile, 'lib/api/materials.ts'), 'utf8');
const snap = readFileSync(join(mobile, 'lib/domain/buildProjectOsSnapshot.ts'), 'utf8');

console.assert(stages.includes("stages/${stageId}/start") && stages.includes('offline_queued'), 'startStage offline');
console.assert(estimate.includes('propose-lock') && estimate.includes('offline_queued'), 'propose offline');
console.assert(schedule.includes('submitWorkSchedule') && schedule.includes('offline_queued'), 'schedule offline');
console.assert(materials.includes('createPurchase') && materials.includes('offline_queued'), 'purchase offline');
console.assert(snap.includes('`/stage/${reviewStage.id}`'), 'hero accept → stage');
console.assert(snap.includes("button: 'Принять этап'"), 'accept button label');
console.log('journeyUnify.w106.test.ts OK');
