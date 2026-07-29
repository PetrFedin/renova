import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const mobile = join(__dirname, '..');
const repo = join(mobile, '..', '..');
const readMobile = (relativePath: string) => readFileSync(join(mobile, relativePath), 'utf8');
const readBackend = (relativePath: string) => readFileSync(join(repo, 'backend', relativePath), 'utf8');
const must = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message);
};

const estimateApi = readMobile('lib/api/estimate.ts');
const endpoint = readBackend('app/api/v1/change_orders.py');
const idempotency = readBackend('app/services/client_write_idempotency.py');
const effects = readBackend('app/services/client_write_side_effects.py');
const prepare = readBackend('app/services/change_order_create_service.py');

const createStart = estimateApi.indexOf('createChangeOrder: async');
const createEnd = estimateApi.indexOf('approveChangeOrder:', createStart);
const createBlock = estimateApi.slice(createStart, createEnd);
must(createStart >= 0 && createEnd > createStart, 'change-order create API block exists');
must(createBlock.includes("createClientRequestId('change-order')"), 'mobile creates scoped request id');
must(createBlock.includes('client_request_id:'), 'mobile sends request id');
must(createBlock.includes('const serialized = JSON.stringify(requestBody)'), 'mobile serializes request once');
must((createBlock.match(/body: serialized/g) || []).length === 2, 'online and offline use the same serialized request');

must(endpoint.includes('CHANGE_ORDER_CREATE_SCOPE = "change_order.create"'), 'backend has stable change-order scope');
must(endpoint.includes('client_request_id: str | None'), 'backend validates request id');
must(endpoint.includes('replay_entity_id(') && endpoint.includes('commit_client_write('), 'endpoint replays before atomic commit');
must(endpoint.includes('"idempotency_conflict"') && endpoint.includes('"replayed": True'), 'endpoint exposes conflict and replay semantics');
must(prepare.includes('await db.flush()') && !prepare.includes('await db.commit()'), 'order is prepared inside caller transaction');
must(idempotency.includes('prepare_client_write_side_effects') && idempotency.includes('activate_client_write_side_effects'), 'client write commits every side effect');
must(effects.includes('scope == "change_order.create"'), 'change-order effects are transactional');
must(effects.includes('kind": "ChangeOrderCreated"') && effects.includes('notification_type": "change_order"'), 'activity and notification are durable');

console.log('changeOrderCreateIdempotency.test OK');
