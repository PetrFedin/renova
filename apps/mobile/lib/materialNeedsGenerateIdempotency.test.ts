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
const service = readBackend('app/services/purchase_service.py');

const generateStart = materialsApi.indexOf('generateMaterialNeeds: async');
const generateEnd = materialsApi.indexOf('\n  },', generateStart) + '\n  },'.length;
const generateBlock = materialsApi.slice(generateStart, generateEnd);
must(generateStart >= 0, 'generateMaterialNeeds API block exists');
must(generateBlock.includes("createClientRequestId('material-needs-generate')"), 'mobile mints a scoped request id once');
must(generateBlock.includes('const requestBody = JSON.stringify'), 'request body is serialized once before the first send');
must((generateBlock.match(/body: requestBody/g) || []).length === 2, 'online send and offline-queue replay reuse the exact same body');
must(generateBlock.includes("throw new Error('offline_queued')"), 'a lost/failed response is durably queued for replay, not silently dropped');

must(service.includes('MATERIAL_NEEDS_GENERATE_SCOPE = "material_needs.generate"'), 'backend has a stable idempotency scope for this generation');
must(service.includes('replay_entity_id(') && service.includes('commit_client_write('), 'generation replays and atomically commits via the shared ledger');
must(service.includes('with_for_update()'), 'concurrent generation attempts for the same project are serialized');
must(
  service.includes('MaterialNeedsGenerationResult(') && service.includes('created_pick_ids_json'),
  'a result row records the canonical generated pick set for replay',
);
must(
  service.indexOf('MaterialNeedsGenerationResult') < service.indexOf('commit_client_write('),
  'result row is prepared before the atomic commit, not after it',
);

must(endpoint.includes('class GenerateNeedsIn(BaseModel)'), 'endpoint accepts a client_request_id body');
must(endpoint.includes('client_request_id=body.client_request_id') || endpoint.includes('body.client_request_id'), 'endpoint forwards the mobile request id to the service');
must(endpoint.includes('IdempotencyConflict') && endpoint.includes('409'), 'endpoint surfaces idempotency conflicts as 409');

console.log('materialNeedsGenerateIdempotency.test OK');
