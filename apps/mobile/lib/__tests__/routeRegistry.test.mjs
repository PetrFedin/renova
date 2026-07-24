/** Run: node apps/mobile/lib/__tests__/routeRegistry.test.mjs */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, '../routeRegistry.ts'), 'utf8');

// Minimal extract: count dock entries and require more centers
const dockCount = (src.match(/visibility: 'dock'/g) || []).length;
assert.equal(dockCount, 5, `dock=${dockCount}`);
assert.ok(src.includes("id: 'chat'") && src.includes("visibility: 'dock'"), 'Chat is mandatory dock contract');
for (const id of ['finance-center', 'manager-dashboard', 'quality-control', 'work-acceptance', 'documents', 'work-schedule', 'reports']) {
  assert.ok(src.includes(`id: '${id}'`), `missing ${id}`);
}
assert.ok(src.includes("status: 'wip'") === false || !src.match(/id: 'reports'[\s\S]*status: 'wip'/), 'reports should not be wip');
assert.ok(src.includes("assertRouteRegistryInvariants"), 'invariants helper');

for (const id of ['inbox', 'scan-receipt', 'stage', 'materials-procurement', 'selections', 'conflicts']) {
  assert.ok(src.includes(`id: '${id}'`), `missing ${id}`);
}

console.log('OK routeRegistry invariants (dock=5, secondary centers listed)');

assert.ok(src.includes("id: 'finance-center'") && src.includes("visibility: 'hidden'"), 'finance-center hidden');

assert.ok(src.includes("id: 'reports'") && src.includes("visibility: 'more'") && src.includes("status: 'beta'"), 'reports promoted to more/beta');
assert.ok(src.includes("entryPoints: ['home.completion', 'home.more', 'os.menu']"), 'reports entryPoints');
assert.ok(
  src.includes("redirectTarget: { routeId: 'budget', tab: 'deviations' }") && src.includes("id: 'project-analytics'"),
  'project-analytics typed redirect',
);
assert.ok(!src.includes("redirectTo:"), 'registry has no bare redirect strings');
assert.ok(!src.match(/id: 'reports'[\s\S]*?status: 'wip'/), 'reports not wip');
assert.ok(!src.match(/id: 'project-analytics'[\s\S]*?status: 'wip'/), 'project-analytics not wip');
