import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { STAGE_STATUS_LABEL, stageStatusLabel } from '@/constants/labels';

const repo = join(__dirname, '..', '..', '..');
const entities = readFileSync(join(repo, 'backend/app/models/entities.py'), 'utf8');
const block = entities.match(/class StageStatus\(str, enum\.Enum\):([\s\S]*?)\n\n/);
assert.ok(block, 'StageStatus enum found');
const backend = [...block![1].matchAll(/^\s+(\w+) = "/gm)].map((m) => m[1]);

// Финальный отчёт отдаёт s.status.value — каждая подпись должна быть русской, не кодом.
for (const s of backend) {
  assert.ok(STAGE_STATUS_LABEL[s], `label for ${s}`);
  assert.notEqual(stageStatusLabel(s), s, `${s} is translated`);
  assert.match(stageStatusLabel(s), /[А-Яа-я]/);
}
assert.deepEqual(Object.keys(STAGE_STATUS_LABEL).sort(), [...backend].sort(), 'labels match backend enum');

const view = readFileSync(join(__dirname, '../components/reports/FinalReportView.tsx'), 'utf8');
assert.ok(!/\{w\.status\}/.test(view), 'FinalReportView does not print raw status');
assert.ok(view.includes('stageStatusLabel(w.status)'));

console.log('finalReportLabels.test.ts ok');
