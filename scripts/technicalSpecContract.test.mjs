#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const spec = read('docs/RENOVA-TECHNICAL-SPECIFICATION.md');
const board = read('docs/technical-spec/PRODUCT-COMPLETION-BOARD.md');
const roadmap = read('docs/technical-spec/CHANGELOG-ROADMAP.md');
const governance = read('docs/technical-spec/END-TO-END-GOVERNANCE.md');
const mandate = read('docs/technical-spec/PRODUCT-COMPLETION-MANDATE.md');
const kickoff = read('.agent/kickoff.md');
const warrantyAnnex = read('docs/technical-spec/WARRANTY-ATOMICITY-CONTRACT.md');
const paymentEvidenceAnnex = read('docs/technical-spec/MANUAL-PAYMENT-EVIDENCE-CONTRACT.md');
const materialPriceAnnex = read('docs/technical-spec/MATERIAL-PRICE-TRUTH-CONTRACT.md');
const projectParticipantAnnex = read('docs/technical-spec/PROJECT-PARTICIPANT-SCOPE-CONTRACT.md');

const requiredSpecSections = [
  '# 0. Главный продуктовый принцип',
  '# 1. Назначение продукта и границы системы',
  '# 3. Runtime architecture',
  '# 4. Data/domain model — системная карта',
  '# 5. Transaction, idempotency, outbox и provider boundary',
  '# 6. API composition',
  '# 7. Session/account/offline truth',
  '# 8. Security and object authority',
  '# 9. Financial and calculation truth',
  '# 10. Основные business flows и связи',
  '# 11. Mobile information architecture and navigation',
  '# 13. UI design system — exact source tokens and UX outcome contract',
  '# 14. Tests and verification matrix',
  '# 15. Независимые критические PR-контуры и evidence classes',
  '# 16. Known gaps / improvement backlog',
  '# 17. Traceability matrix',
  '# 18. Documentation Definition of Done',
  '# 19. Текущий приоритетный порядок',
  '# 20. Final Definition of Done',
  '# 21. Machine-verifiable source snapshot',
];
for (const heading of requiredSpecSections) {
  assert.ok(spec.includes(heading), `technical specification missing required section: ${heading}`);
}

for (const token of [
  '`PROVEN`', '`CANDIDATE PROVEN`', '`PARTIAL`', '`BLOCKED`', '`FUTURE EXTERNAL`',
  '**VERIFIED**', '**PENDING REVERIFY**', '**TBD / UNVERIFIED**',
  'PRODUCT-COMPLETION-BOARD.md', 'PRODUCT-COMPLETION-MANDATE.md', 'CHANGELOG-ROADMAP.md',
  'renova-local', 'npm run dev -- doctor', 'npm run dev -- seed', 'npm run dev -- test-focused', 'npm run dev -- test-full',
  'w16legacystatus01', 'w17chatmessageenum01', 'w18nativeenumparity01',
]) {
  assert.ok(spec.includes(token), `technical specification missing living-contract token: ${token}`);
}

const requiredBoardSections = [
  '## 0. Completion invariant',
  '## 1. Правило актуальности и источники истины',
  '## 2. Текущая общая правда',
  '## 3. Mode Board — M01–M12',
  '## 4. Golden Path Board — GP1–GP8',
  '## 5. Mutation Board — exact 26 mutating mobile surfaces',
  '## 6. Exact-candidate evidence ledger',
  '## 7. Integration DAG — текущий порядок',
  '## 8. Как выбирать следующую работу',
  '## 10. Final PRODUCT COMPLETE gate',
];
for (const heading of requiredBoardSections) {
  assert.ok(board.includes(heading), `completion board missing required section: ${heading}`);
}
for (const state of ['PROVEN', 'CANDIDATE PROVEN', 'PARTIAL', 'BLOCKED', 'FUTURE EXTERNAL']) {
  assert.ok(board.includes(`\`${state}\``), `completion board missing readiness state: ${state}`);
}

function sectionBetween(text, start, end) {
  const startIndex = text.indexOf(start);
  const endIndex = text.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0 && endIndex > startIndex, `unable to isolate section ${start}`);
  return text.slice(startIndex, endIndex);
}

const modeSection = sectionBetween(board, '## 3. Mode Board — M01–M12', '## 4. Golden Path Board — GP1–GP8');
const gpSection = sectionBetween(board, '## 4. Golden Path Board — GP1–GP8', '## 5. Mutation Board — exact 26 mutating mobile surfaces');
const mutationSection = sectionBetween(board, '## 5. Mutation Board — exact 26 mutating mobile surfaces', '## 6. Exact-candidate evidence ledger');

const modeIds = [...modeSection.matchAll(/^\| M(\d{2})\b/gm)].map((m) => Number(m[1]));
assert.deepEqual(modeIds, Array.from({ length: 12 }, (_, i) => i + 1), `completion board must contain exact M01-M12 rows; got ${modeIds.join(',')}`);

const gpIds = [...gpSection.matchAll(/^\| GP(\d) \|/gm)].map((m) => Number(m[1]));
assert.deepEqual(gpIds, Array.from({ length: 8 }, (_, i) => i + 1), `completion board must contain exact GP1-GP8 rows; got ${gpIds.join(',')}`);

const mutationIds = [...mutationSection.matchAll(/^\| F(\d{2}) \|/gm)].map((m) => Number(m[1]));
assert.deepEqual(mutationIds, Array.from({ length: 26 }, (_, i) => i + 1), `completion board must contain exact F01-F26 mutation rows; got ${mutationIds.join(',')}`);
assert.ok(mutationSection.includes('25 business modules + `client.ts` transport/session owner'), 'completion board must preserve #431 exact 25+client mutation inventory semantics');

for (let wave = 0; wave <= 9; wave += 1) {
  assert.ok(roadmap.includes(`### Wave ${wave}`), `roadmap missing dependency-aware Wave ${wave}`);
}
for (const token of [
  'security/data/money corruption',
  'atomicity/recovery',
  'session/offline/cache',
  'Human Usability Closure',
  'final internal PRODUCT COMPLETE candidate',
]) {
  assert.ok(roadmap.includes(token), `roadmap missing priority/integration token: ${token}`);
}

const expectedMandateIds = [
  ...Array.from({ length: 7 }, (_, i) => `A${i + 1}`),
  ...Array.from({ length: 5 }, (_, i) => `B${i + 1}`),
  ...Array.from({ length: 8 }, (_, i) => `C${i + 1}`),
  ...Array.from({ length: 3 }, (_, i) => `D${i + 1}`),
  ...Array.from({ length: 4 }, (_, i) => `E${i + 1}`),
];
const mandateIds = [...mandate.matchAll(/^\*\*([A-E]\d) · P\d · /gm)].map((m) => m[1]);
assert.deepEqual(mandateIds, expectedMandateIds, `mandate task catalogue changed unexpectedly: ${mandateIds.join(',')}`);
assert.ok(mandate.includes('Board управляет execution order, mandate управляет acceptance'), 'mandate must delegate live execution order to the Completion Board without weakening acceptance');

const kickoffBoard = kickoff.indexOf('PRODUCT-COMPLETION-BOARD.md');
const kickoffMandate = kickoff.indexOf('PRODUCT-COMPLETION-MANDATE.md');
assert.ok(kickoffBoard >= 0 && kickoffMandate >= 0 && kickoffBoard < kickoffMandate, 'agent kickoff must read Completion Board before Mandate');
assert.ok(governance.includes('Mandatory pre-task reconciliation'), 'governance must require live pre-task reconciliation');
assert.ok(governance.includes('Priority resolver'), 'governance must define priority resolver');
assert.ok(governance.includes('Evidence принадлежит exact SHA'), 'governance must keep exact-SHA evidence freshness');

function gitBlobSha(content) {
  const bytes = Buffer.from(content, 'utf8');
  return crypto
    .createHash('sha1')
    .update(Buffer.from(`blob ${bytes.length}\0`, 'utf8'))
    .update(bytes)
    .digest('hex');
}

const trackedSources = [
  'AGENTS.md',
  'backend/app/api/v1/router.py',
  'backend/app/models/entities.py',
  'backend/app/main.py',
  'backend/app/services/seed_demo.py',
  'backend/scripts/verify_orm_schema_parity.py',
  'backend/scripts/verify_current_migration_schema.py',
  'apps/mobile/lib/routeRegistry.ts',
  'apps/mobile/constants/Theme.ts',
  'apps/mobile/constants/typography.ts',
  'apps/mobile/constants/screenTypography.ts',
  'apps/mobile/constants/uiTokens.ts',
  'apps/mobile/constants/screenLayout.ts',
  'apps/mobile/components/renova/os/OsHubTabs.tsx',
  'apps/mobile/components/screens/OsObjectHubScreen.tsx',
  'apps/mobile/components/screens/OsRepairHubScreen.tsx',
  'apps/mobile/components/screens/OsBudgetHubScreen.tsx',
  'apps/mobile/constants/budgetTabs.ts',
  '.cursor/rules/renova-design-system.mdc',
  'package.json',
  '.github/workflows/local-runtime-integrity.yml',
  'backend/alembic/versions/w16legacystatus01_legacy_status_enum_parity.py',
  'backend/alembic/versions/w17chatmessageenum01_chat_message_enum_parity.py',
  'backend/alembic/versions/w18nativeenumparity01_remaining_native_enum_parity.py',
  'docs/technical-spec/CHANGELOG-ROADMAP.md',
];

for (const file of trackedSources) {
  const actualSha = gitBlobSha(read(file));
  const expectedRowPrefix = `| \`${file}\` | \`${actualSha}\` |`;
  const synchronizedDocumentation = file === 'backend/app/api/v1/router.py'
    ? `${spec}\n${warrantyAnnex}\n${paymentEvidenceAnnex}\n${materialPriceAnnex}\n${projectParticipantAnnex}`
    : spec;
  assert.ok(
    synchronizedDocumentation.includes(expectedRowPrefix),
    `technical specification source snapshot is stale for ${file}; update source row and affected documentation`,
  );
}

const registry = read('apps/mobile/lib/routeRegistry.ts');
const registryBody = registry.match(/export const RENOVA_ROUTES:[\s\S]*?= \[([\s\S]*?)\n\];/)?.[1];
assert.ok(registryBody, 'unable to locate RENOVA_ROUTES registry body');
const routeIds = [...registryBody.matchAll(/\bid:\s*'([^']+)'/g)].map((match) => match[1]);
assert.ok(routeIds.length >= 20, `unexpectedly small route registry (${routeIds.length}); parser or source changed`);
for (const routeId of routeIds) {
  assert.ok(spec.includes(`| ${routeId} |`), `technical specification route inventory missing canonical route id: ${routeId}`);
}

const theme = read('apps/mobile/constants/Theme.ts');
for (const [sourceToken, documentedToken] of [
  ["primary: '#334155'", '| primary | `#334155` |'],
  ["accent: '#2563EB'", '| accent | `#2563EB` |'],
  ['minTouch: 44', 'Minimum touch target: **44 px**'],
  ['display: 32', 'display 32'],
  ['hero: 24', 'hero    24'],
  ['h1: 22', 'h1      22'],
  ['body: 14', 'body    14'],
]) {
  assert.ok(theme.includes(sourceToken), `Theme contract changed: ${sourceToken}`);
  assert.ok(spec.includes(documentedToken), `technical specification missing current Theme value: ${documentedToken}`);
}

const objectHub = read('apps/mobile/components/screens/OsObjectHubScreen.tsx');
const repairHub = read('apps/mobile/components/screens/OsRepairHubScreen.tsx');
const budgetTabs = read('apps/mobile/constants/budgetTabs.ts');
for (const token of ['rooms', 'estimate', 'plan', 'profile']) {
  assert.ok(objectHub.includes(`'${token}'`), `Object hub source missing expected tab ${token}`);
  assert.ok(spec.includes(`\`${token}\``), `spec missing Object hub source key ${token}`);
}
for (const token of ['works', 'materials', 'selections', 'control']) {
  assert.ok(repairHub.includes(`'${token}'`), `Repair hub source missing expected tab ${token}`);
  assert.ok(spec.includes(`\`${token}\``), `spec missing Repair hub source key ${token}`);
}
for (const token of ['summary', 'expenses', 'payments', 'deviations']) {
  assert.ok(budgetTabs.includes(`'${token}'`), `Budget tabs source missing expected tab ${token}`);
  assert.ok(spec.includes(`\`${token}\``), `spec missing Budget hub source key ${token}`);
}

const specMainCut = spec.match(/\*\*Канонический `main` на момент сверки:\*\* `([^`]+)`/)?.[1];
const boardMainCut = board.match(/\*\*Канонический `main` на момент сверки:\*\* `([^`]+)`/)?.[1];
assert.ok(specMainCut && boardMainCut, 'master and board must both declare canonical main evidence cut');
assert.equal(specMainCut, boardMainCut, `master/board main evidence cut drift: ${specMainCut} != ${boardMainCut}`);

console.log(`Renova living specification contract: OK (${routeIds.length} canonical routes, ${trackedSources.length} source snapshots, M01-M12, GP1-GP8, F01-F26, A1-E4)`);
