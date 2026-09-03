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
const roadmap = read('docs/technical-spec/CHANGELOG-ROADMAP.md');
const warrantyAnnex = read('docs/technical-spec/WARRANTY-ATOMICITY-CONTRACT.md');

const requiredSections = [
  '# 1. Назначение продукта и границы системы',
  '# 3. Runtime architecture',
  '# 4. Data/domain model — системная карта',
  '# 5. Transaction, idempotency, outbox и provider boundary',
  '# 6. API composition',
  '# 7. Mobile information architecture and navigation',
  '# 8. Hub screens — состав, переходы, badges и progressive disclosure',
  '# 9. UI design system — точные токены',
  '# 10. Основные business flows и связи',
  '# 11. Calculations and derived state',
  '# 14. Tests and verification matrix',
  '# 15. Независимые критические PR-контуры',
  '# 16. Known gaps / improvement backlog',
  '# 17. Traceability matrix',
  '# 18. Documentation Definition of Done',
];
for (const heading of requiredSections) {
  assert.ok(spec.includes(heading), `technical specification missing required section: ${heading}`);
}

for (const token of [
  '**VERIFIED**',
  '**PENDING REVERIFY**',
  '**TBD / UNVERIFIED',
  '#282', '#283', '#284', '#287', '#286',
  'w16legacystatus01',
  'w17chatmessageenum01',
  'w18nativeenumparity01',
  'CHANGELOG-ROADMAP.md',
  'renova-local',
  'npm run dev -- doctor',
  'npm run dev -- seed',
  'npm run dev -- test-focused',
  'npm run dev -- test-full',
]) {
  assert.ok(spec.includes(token), `technical specification missing contract token: ${token}`);
}

for (const token of [
  'наблюдение → решение → код/данные → тест → evidence → следующий шаг',
  'P0.1. Закрыть canonical local runtime end-to-end',
  'P0.2. Полная native PostgreSQL enum parity',
  'P1.1. Полный screen contract inventory',
]) {
  assert.ok(roadmap.includes(token), `technical roadmap missing governance token: ${token}`);
}

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
    ? `${spec}\n${warrantyAnnex}`
    : spec;
  assert.ok(
    synchronizedDocumentation.includes(expectedRowPrefix),
    `technical specification source snapshot is stale for ${file}; update the affected documentation and blob SHA`,
  );
}

const registry = read('apps/mobile/lib/routeRegistry.ts');
const registryBody = registry.match(/export const RENOVA_ROUTES:[\s\S]*?= \[([\s\S]*?)\n\];/)?.[1];
assert.ok(registryBody, 'unable to locate RENOVA_ROUTES registry body');
const routeIds = [...registryBody.matchAll(/\bid:\s*'([^']+)'/g)].map((match) => match[1]);
assert.ok(routeIds.length >= 20, `unexpectedly small route registry (${routeIds.length}); parser or source changed`);
for (const routeId of routeIds) {
  assert.ok(
    spec.includes(`| ${routeId} |`),
    `technical specification route matrix is missing canonical route id: ${routeId}`,
  );
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
  assert.ok(spec.includes(`\`${token}\``), `spec missing Object hub tab ${token}`);
}
for (const token of ['works', 'materials', 'selections', 'control']) {
  assert.ok(repairHub.includes(`'${token}'`), `Repair hub source missing expected tab ${token}`);
  assert.ok(spec.includes(`\`${token}\``), `spec missing Repair hub tab ${token}`);
}
for (const token of ['summary', 'expenses', 'payments', 'deviations']) {
  assert.ok(budgetTabs.includes(`'${token}'`), `Budget tabs source missing expected tab ${token}`);
  assert.ok(spec.includes(`\`${token}\``), `spec missing Budget hub tab ${token}`);
}

console.log(`Renova technical specification contract: OK (${routeIds.length} canonical routes, ${trackedSources.length} tracked sources)`);
