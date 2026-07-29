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
const endpoint = readBackend('app/api/v1/purchases.py');
const helper = readBackend('app/services/purchase_create_service.py');

const createStart = materialsApi.indexOf('createPurchase: async');
const createEnd = materialsApi.indexOf('updatePurchaseStatus:', createStart);
const createBlock = materialsApi.slice(createStart, createEnd);
must(createStart >= 0 && createEnd > createStart, 'purchase create API block exists');
must(createBlock.includes("createClientRequestId('purchase')"), 'mobile creates scoped purchase request id');
must(createBlock.includes('client_request_id:'), 'mobile sends purchase request id');
must(createBlock.includes('const serialized = JSON.stringify(requestBody)'), 'purchase body serializes once');
must((createBlock.match(/body: serialized/g) || []).length === 2, 'online and offline reuse exact purchase body');
must(createBlock.includes("throw new Error('offline_queued')"), 'purchase create is durably queued offline');

must(endpoint.includes('PURCHASE_CREATE_SCOPE = "purchase.create"'), 'backend has stable purchase scope');
must(endpoint.includes('canonical_pick_ids = sorted(set(body.material_pick_ids))'), 'backend canonicalizes pick set');
must(endpoint.includes('replay_entity_id(') && endpoint.includes('commit_client_write('), 'purchase endpoint replays and atomically commits');
must(endpoint.includes('picks_already_in_active_purchase') && endpoint.includes('concurrent_replay_id'), 'active duplicate distinguishes concurrent replay');
must(endpoint.includes('activate_client_write_side_effects'), 'purchase activity delivery is immediately routable');
must(endpoint.includes('"replayed"] = True') && endpoint.includes('"idempotency_conflict"'), 'purchase exposes replay/conflict semantics');

must(helper.includes('query = query.with_for_update()'), 'material picks are locked before duplicate check');
must(helper.includes('len(picks) != len(canonical_ids)'), 'foreign or missing picks reject entire request');
must(helper.includes('Purchase.status.in_(_ACTIVE_PURCHASE_STATUSES)'), 'active purchase membership blocks duplicate order');
must(helper.includes('await db.flush()') && !helper.includes('await db.commit()'), 'purchase is prepared inside caller transaction');
const activeStart = helper.indexOf('_ACTIVE_PURCHASE_STATUSES = {');
const activeEnd = helper.indexOf('}', activeStart);
const activeStatuses = helper.slice(activeStart, activeEnd + 1);
must(activeStart >= 0 && activeEnd > activeStart, 'active purchase status set exists');
must(activeStatuses.includes('PurchaseStatus.draft') && activeStatuses.includes('PurchaseStatus.delivered'), 'all live purchase states keep picks locked');
must(!activeStatuses.includes('PurchaseStatus.cancelled') && !activeStatuses.includes('PurchaseStatus.returned'), 'terminal purchases release picks for reorder');

console.log('purchaseCreateIdempotency.test OK');
