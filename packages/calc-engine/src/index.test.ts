import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { calcRoomMetrics, calcEstimateSummary, generateTemplateLines, calcProjectDashboard, wallpaperRolls } from './index';

// Падающие проверки (throw), а не console.assert: иначе тест не ловит регрессии (EST-030).
function check(cond: boolean, msg: string) {
  if (!cond) throw new Error(`calc-engine: ${msg}`);
}

const metrics = calcRoomMetrics({ lengthM: 4.2, widthM: 3.1, heightM: 2.7, openingsSqM: 2 });
check(metrics.floorSqM === 13.02, 'floor');
const { works, materials } = generateTemplateLines('cosmetic', 'r1', metrics);
const summary = calcEstimateSummary(materials, works);
check(summary.grandTotal > 0, 'total');
const dash = calcProjectDashboard({
  stages: [{ weight: 1, percentComplete: 50 }, { weight: 2, percentComplete: 30 }],
  budgetPlanned: 847000,
  budgetSpent: 412000,
  materialPlanned: 200000,
  materialSpent: 216000,
  plannedEndDate: new Date('2026-08-01'),
});
check(Boolean(dash), 'dashboard');

// Общие эталоны (их же проверяют backend и apps/mobile/lib/calc-engine).
const reference = JSON.parse(readFileSync(join(__dirname, '../reference-cases.json'), 'utf8')) as {
  cases: Array<{ name: string; room: Record<string, number>; expected: Record<string, number> }>;
};
for (const c of reference.cases) {
  const m = calcRoomMetrics({ lengthM: c.room.length_m, widthM: c.room.width_m, heightM: c.room.height_m, openingsSqM: c.room.openings_sq_m });
  check(Math.abs(m.wallSqM - c.expected.wall_sq_m) < 0.005, `${c.name} wall`);
  check(wallpaperRolls(m.wallSqM) === c.expected.wallpaper_rolls, `${c.name} wallpaper`);
}
console.log('calc-engine OK');
