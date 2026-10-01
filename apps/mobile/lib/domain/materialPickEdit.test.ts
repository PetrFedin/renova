import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { materialEditPolicy, parseMaterialForm } from './materialPickEdit';

const must = (c: boolean, m: string) => { if (!c) throw new Error(m); };

// EST-026: количество и единица вводятся, «12,5» не превращается в 0
const ok = parseMaterialForm({ name: ' Плитка ', qty: '12,5', unit: 'м²', price: '1 250,50' });
must(ok.ok && ok.qty === 12.5 && ok.unit === 'м²' && ok.price === 1250.5 && ok.name === 'Плитка', 'parses locale numbers');
must(!parseMaterialForm({ name: '', qty: '1', unit: 'шт' }).ok, 'name required');
must(!parseMaterialForm({ name: 'x', qty: '0', unit: 'шт' }).ok, 'qty > 0');
must(!parseMaterialForm({ name: 'x', qty: 'abc', unit: 'шт' }).ok, 'qty numeric');
must(!parseMaterialForm({ name: 'x', qty: '1', unit: '' }).ok, 'unit required');
must(!parseMaterialForm({ name: 'x', qty: '1', unit: 'x'.repeat(17) }).ok, 'unit max 16');
must(!parseMaterialForm({ name: 'x', qty: '1', unit: 'шт', price: '-5' }).ok, 'price >= 0');
const stock = parseMaterialForm({ name: 'x', qty: '4', unit: 'шт', allInStock: true });
must(stock.ok && stock.available === 4, 'on-hand means all in stock');
must(!parseMaterialForm({ name: 'x', qty: '4', unit: 'шт', availableText: '5' }).ok, 'available <= qty');

// EST-025: кто что видит
must(materialEditPolicy('draft', 'contractor').canEdit && materialEditPolicy('draft', 'contractor').canDelete, 'draft editable');
must(materialEditPolicy('pending', 'customer').canEdit, 'pending editable');
must(!materialEditPolicy('approved', 'contractor').canRevoke, 'only customer revokes');
must(materialEditPolicy('approved', 'customer').canRevoke && !materialEditPolicy('approved', 'customer').canEdit, 'approved: revoke, not edit');
must(!materialEditPolicy('purchased', 'customer').canRevoke && !materialEditPolicy('purchased', 'customer').canDelete, 'purchased is terminal');
const ro = materialEditPolicy('draft', 'customer', true);
must(!ro.canEdit && !ro.canDelete && !ro.canRevoke, 'read-only hides everything');

// Офлайн/идемпотентность: новые записи уходят в очередь тем же телом, DELETE/PATCH естественно идемпотентны
const root = join(__dirname, '..', '..');
const api = readFileSync(join(root, 'lib/api/materials.ts'), 'utf8');
for (const fn of ['patchMaterialPick', 'deleteMaterialPick', 'revokeMaterialPick']) {
  const i = api.indexOf(`${fn}: async`);
  must(i > 0, `${fn} exists`);
  const chunk = api.slice(i, i + 900);
  must(chunk.includes('isQueueableWriteError') && chunk.includes("enqueue({") && chunk.includes("offline_queued"), `${fn} queues offline`);
}
must(readFileSync(join(root, 'lib/api/floor.ts'), 'utf8').includes('/cancel`'), 'cancelWasteOrder wired');
must(readFileSync(join(root, 'lib/api/selections.ts'), 'utf8').includes('approveBody'), 'approveSelection queues the same body with qty');
const list = readFileSync(join(root, 'components/renova/MaterialPickList.tsx'), 'utf8');
must(!list.includes("qty: 1,\n                unit: 'шт'"), 'manual material no longer hardcodes 1 шт');
must(!list.includes("role === 'contractor' && showForm"), 'customer gets the create form too');
console.log('materialPickEdit.test OK');
