/** Run: node apps/mobile/lib/__tests__/routeRegistry.test.mjs */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, '../routeRegistry.ts'), 'utf8');

// Minimal extract: count dock entries and require more centers
const dockCount = (src.match(/visibility: 'dock'/g) || []).length;
assert.ok(dockCount <= 4, `dock=${dockCount}`);
for (const id of ['finance-center', 'manager-dashboard', 'quality-control', 'work-acceptance', 'documents', 'work-schedule']) {
  assert.ok(src.includes(`id: '${id}'`), `missing ${id}`);
}
assert.ok(src.includes("assertRouteRegistryInvariants"), 'invariants helper');

for (const id of ['inbox', 'scan-receipt', 'stage', 'materials-procurement', 'conflicts']) {
  assert.ok(src.includes(`id: '${id}'`), `missing ${id}`);
}

console.log('OK routeRegistry invariants (dock≤4, secondary centers listed)');
