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
// PATCH идёт через сервис: эндпоинт не правит материал сам, а сервис блокирует строку,
// допускает правку только draft/pending и запрещает её при активной закупке.
must(endpoint.includes('pick_svc.update_pick_fields('), 'PATCH material goes through the service');
must(endpoint.includes('PickPatchIn') && !/\bprice:/.test(endpoint.slice(endpoint.indexOf('class PickPatchIn'), endpoint.indexOf('class RejectPickIn'))), 'PATCH body cannot carry price (separate provenance contract)');
const updateStart = service.indexOf('async def update_pick_fields(');
const updateEnd = service.indexOf('\nasync def ', updateStart + 10);
const updateBlock = service.slice(updateStart, updateEnd < 0 ? undefined : updateEnd);
must(updateStart >= 0, 'service has update_pick_fields');
must(updateBlock.includes('for_update=True'), 'edit locks the material row');
must(updateBlock.includes('MaterialPickStatus.draft, MaterialPickStatus.pending') && updateBlock.includes('material_pick_not_editable'), 'edit allowed only for draft/pending');
must(updateBlock.includes('material_pick_has_active_purchase(') && updateBlock.includes('material_pick_locked_by_purchase'), 'edit blocked by active purchase');
must(!updateBlock.includes('"price"'), 'edit service does not touch price');
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
