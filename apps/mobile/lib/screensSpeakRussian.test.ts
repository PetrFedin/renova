/**
 * Экран не должен показывать человеку перечисление сервера как есть:
 * «requested», «foreman», «accepted_with_remarks» — это не текст для людей.
 * Заодно сверяем, что у каждого значения с сервера есть подпись.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const mobile = join(__dirname, '..');
const repo = join(mobile, '..', '..');
const src = (rel: string) => readFileSync(join(mobile, rel), 'utf8');
const backend = (rel: string) => readFileSync(join(repo, 'backend', rel), 'utf8');

const labels = src('constants/labels.ts');

function enumValues(source: string, name: string): string[] {
  const block = source.split(`class ${name}`)[1]?.split('\nclass ')[0] ?? '';
  return [...block.matchAll(/^\s+\w+ = "([a-z_]+)"/gm)].map((m) => m[1]);
}

function labelMap(name: string): Record<string, string> {
  const block = labels.split(`export const ${name}: Record<string, string> = {`)[1]?.split('};')[0];
  if (!block) throw new Error(`нет карты подписей ${name}`);
  const map: Record<string, string> = {};
  for (const m of block.matchAll(/(\w+):\s*'([^']*)'/g)) map[m[1]] = m[2];
  return map;
}

const entities = backend('app/models/entities.py');
const schedule = backend('app/models/work_schedule.py');

const checks: [string, string[], string][] = [
  ['ACCEPTANCE_STATUS_LABEL', enumValues(entities, 'AcceptanceStatus'), 'приёмка'],
  ['JOB_LEAD_STATUS_LABEL', enumValues(entities, 'JobLeadStatus'), 'заявка'],
  ['SELECTION_STATUS_LABEL', enumValues(entities, 'SelectionStatus'), 'подбор'],
  ['PURCHASE_STATUS_LABEL', enumValues(entities, 'PurchaseStatus'), 'закупка'],
  ['WORK_SCHEDULE_STATUS_LABEL', enumValues(schedule, 'WorkScheduleStatus'), 'график'],
];

for (const [mapName, values, what] of checks) {
  if (!values.length) throw new Error(`не удалось прочитать перечисление для «${what}»`);
  const map = labelMap(mapName);
  const missing = values.filter((v) => !(v in map));
  if (missing.length) throw new Error(`${what}: без подписи останутся ${missing.join(', ')}`);
  for (const [key, text] of Object.entries(map)) {
    if (!/[А-Яа-яЁё]/.test(text)) throw new Error(`${mapName}.${key} — подпись без русских букв: «${text}»`);
  }
}

const teamRoles = backend('app/services/team_service.py');
const rolesLine = teamRoles.split('TEAM_MEMBER_ROLES = frozenset({')[1]?.split('})')[0] ?? '';
const serverRoles = [...rolesLine.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
if (!serverRoles.length) throw new Error('не удалось прочитать роли бригады');
const roleMap = labelMap('TEAM_ROLE_LABEL');
for (const role of serverRoles) {
  if (!(role in roleMap)) throw new Error(`роль «${role}» останется на экране латиницей`);
}

/** Места, где перечисление раньше уходило на экран сырым. */
const RAW = [
  ['components/renova/TechnicalSupervisionScheduleReview.tsx', '{schedule.status}'],
  ['components/renova/StageExpensePanel.tsx', '· {p.status}'],
  ['components/renova/JobLeadsBoard.tsx', '· {l.status}'],
  ['components/screens/PortalScreen.tsx', '· {selection.status}'],
  ['components/reports/FinalReportView.tsx', '— {w.status}'],
  ['components/screens/profile/ContractorProfileScreen.tsx', '· {m.role}'],
  ['components/screens/control/TechnicalSupervisionControlView.tsx', '{acceptance.status}'],
  ['components/screens/control/CustomerControlView.tsx', '{w.status}'],
  ['components/renova/chat/ChatTaskSheet.tsx', '· {m.role}'],
] as const;

for (const [file, fragment] of RAW) {
  const text = src(file);
  if (text.includes(fragment)) throw new Error(`${file}: перечисление показано как есть — «${fragment}»`);
  if (!text.includes("from '@/constants/labels'")) throw new Error(`${file}: подписи не подключены`);
}

console.log('screensSpeakRussian.test OK');
