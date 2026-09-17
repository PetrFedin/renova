import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const mobile = join(__dirname, '..');
const repo = join(mobile, '..', '..');
const readMobile = (relativePath: string) => readFileSync(join(mobile, relativePath), 'utf8');
const readBackend = (relativePath: string) => readFileSync(join(repo, 'backend', relativePath), 'utf8');
const must = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message);
};

const materialsApi = readMobile('lib/api/materials.ts');
const endpoint = readBackend('app/api/v1/materials.py');
const service = readBackend('app/services/material_pick_service.py');
// Price mutation left materials.py in #311: the `sync-price` route there was
// synthetic (it fabricated `pick.price = 1000.0` when no price was known) and
// was deleted. The real route and its guard now live here.
const priceEndpoint = readBackend('app/api/v1/material_price_sync.py');
const priceService = readBackend('app/services/material_price_service.py');

const createStart = materialsApi.indexOf('createMaterialPick: async');
const createEnd = materialsApi.indexOf('submitMaterialPick:', createStart);
const createBlock = materialsApi.slice(createStart, createEnd);
must(createStart >= 0 && createEnd > createStart, 'material create API block exists');
must(createBlock.includes("createClientRequestId('material-pick')"), 'material create has stable request id');
must(createBlock.includes('const serialized = JSON.stringify(requestBody)'), 'material create serializes once');
must((createBlock.match(/body: serialized/g) || []).length === 2, 'material online and offline paths reuse exact body');
must(createBlock.includes("throw new Error('offline_queued')"), 'material create queues network failures');

must(materialsApi.includes('rejectMaterialPick: async'), 'customer rejection is available to client');
must(materialsApi.includes('/material-picks/${id}/reject'), 'rejection calls dedicated endpoint');
must((materialsApi.match(/\/material-picks\/\$\{id\}\/submit/g) || []).length >= 2, 'submit online and offline paths match');
must((materialsApi.match(/\/material-picks\/\$\{id\}\/approve/g) || []).length >= 2, 'approve online and offline paths match');

must(endpoint.includes('MATERIAL_PICK_CREATE_SCOPE = "material_pick.create"'), 'backend has stable material create scope');
must(endpoint.includes('replay_entity_id(') && endpoint.includes('commit_client_write('), 'material create uses request ledger');
must(endpoint.includes('@router.post("/{project_id}/material-picks/{pick_id}/reject")'), 'backend exposes reject transition');
must(endpoint.includes('user.role != UserRole.customer'), 'approve and reject require customer role');
// The editability guard for prices: asserted where it actually runs, and
// asserted to be unreachable from materials.py, so the deleted synthetic
// route cannot quietly come back. The behavioural proof that the guard
// refuses a pending or purchase-locked pick lives in
// backend/tests/test_material_price_editability.py.
must(
  !/@router\.(post|patch|put)\([^)]*sync-price/.test(endpoint),
  'materials.py must not re-expose a price route; the canonical one is material_price_sync.py',
);
must(
  priceEndpoint.includes('set_manual_material_price(') &&
    priceEndpoint.includes('sync_material_price('),
  'the price routes delegate to the price service rather than assigning price inline',
);
must(
  !/pick\.price\s*=/.test(priceEndpoint),
  'no route may assign a material price directly, bypassing the guard',
);
must(
  priceService.includes('_require_price_mutable_pick('),
  'price mutation requires an editable material',
);
must(
  priceService.includes('material_pick_price_not_editable') &&
    priceService.includes('material_pick_locked_by_purchase'),
  'the guard refuses both a non-editable status and a purchase-locked material',
);
must(endpoint.includes('analog_of_id=pick_id'), 'analog route sets parent exactly once');

must(service.includes('MaterialPick.id == pick_id,') && service.includes('MaterialPick.project_id == project_id,'), 'material lookup is project scoped before mutation');
must(service.includes('query = query.with_for_update()'), 'material transitions use row lock');
must(service.includes('(MaterialPickStatus.draft, "submit")'), 'draft can only submit');
must(service.includes('(MaterialPickStatus.pending, "approve")'), 'pending can approve');
must(service.includes('(MaterialPickStatus.pending, "reject")'), 'pending can return to draft');
must(service.includes('if current == target:') && service.includes('return False'), 'same transition replays without side effects');
must(service.includes('material_pick_locked_by_purchase'), 'active purchase blocks material mutation');
must(service.includes('Purchase.status.in_(_ACTIVE_PURCHASE_STATUSES)'), 'active purchase membership is checked');
must(service.includes('activate_client_write_side_effects(effects)'), 'durable transition effects are immediately routable');
must(!service.includes('await db.commit()\n    await db.refresh(pick)\n    activate_client_write_side_effects(effects)\n    await'), 'transition activates effects only after commit');

console.log('materialPickLifecycleIntegrity.test OK');
