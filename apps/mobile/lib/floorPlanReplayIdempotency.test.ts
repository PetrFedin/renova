import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const mobile = join(__dirname, '..');
const repo = join(mobile, '..', '..');
const readMobile = (relativePath: string) => readFileSync(join(mobile, relativePath), 'utf8');
const readBackend = (relativePath: string) => readFileSync(join(repo, 'backend', relativePath), 'utf8');
const must = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message);
};

const floorApi = readMobile('lib/api/floor.ts');
const furnitureLayer = readMobile('components/renova/FurnitureLayer.tsx');
const floorPlanPanel = readMobile('components/renova/FloorPlanPanel.tsx');
const floorPlansEndpoint = readBackend('app/api/v1/floor_plans.py');
const floorPlanService = readBackend('app/services/floor_plan_service.py');
const idempotency = readBackend('app/services/client_write_idempotency.py');

function block(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  must(start >= 0 && end > start, `block markers found: "${startMarker}" .. "${endMarker}"`);
  return source.slice(start, end);
}

// --- #442/#475: floor-plan create replay identity (mobile) ----------------

const createFloorPlanBlock = block(floorApi, 'createFloorPlan: async', 'pinFloorPlanRoom:');
must(createFloorPlanBlock.includes("createClientRequestId('floor-plan-create')"), 'mobile mints a stable floor-plan-create request id');
must(createFloorPlanBlock.includes('client_request_id:'), 'mobile sends the request id with the floor-plan body');
must(createFloorPlanBlock.includes('const requestBody = JSON.stringify('), 'mobile serializes the floor-plan body once, before the first attempt');
must((createFloorPlanBlock.match(/body: requestBody/g) || []).length === 2, 'online request and queued offline replay send the identical serialized floor-plan body');
must(createFloorPlanBlock.includes('isQueueableWriteError(e)') || createFloorPlanBlock.includes('e.status !== 429'), '429 is replay-safe and queues like transport/5xx');
must(createFloorPlanBlock.includes('!isQueueableWriteError(e)') || createFloorPlanBlock.includes('e.status >= 400 && e.status < 500'), 'deterministic 4xx (except 429) is authoritative and must not be queued');

// --- #475: pin upsert replay identity (mobile) -----------------------------

const pinBlock = block(floorApi, 'pinFloorPlanRoom: async', 'listFurniture:');
must(pinBlock.includes("createClientRequestId('floor-plan-pin-upsert')"), 'mobile mints a stable pin-upsert request id');
must(pinBlock.includes('client_request_id:'), 'mobile sends the request id with the pin body');
must((pinBlock.match(/body: requestBody/g) || []).length === 2, 'online request and queued offline replay send the identical serialized pin body');

// --- #442/#468: furniture create replay identity (mobile) -----------------

const createFurnitureBlock = block(floorApi, 'createFurniture: async', 'moveFurniture:');
must(createFurnitureBlock.includes("createClientRequestId('furniture-create')"), 'mobile mints a stable furniture-create request id');
must(createFurnitureBlock.includes('client_request_id:'), 'mobile sends the request id with the furniture body');
must(createFurnitureBlock.includes('const requestBody = JSON.stringify('), 'mobile serializes the furniture body once, before the first attempt');
must((createFurnitureBlock.match(/body: requestBody/g) || []).length === 2, 'online request and queued offline replay send the identical serialized furniture body');
must(createFurnitureBlock.includes('isQueueableWriteError(e)') || createFurnitureBlock.includes('e.status !== 429'), 'furniture create queues on 429 like transport/5xx');
must(createFurnitureBlock.includes('!isQueueableWriteError(e)') || createFurnitureBlock.includes('e.status >= 400 && e.status < 500'), 'deterministic furniture 4xx (except 429) is authoritative and must not be queued');

// #468: the component must go through the canonical producer only — no
// component-level catch-all that reconstructs a different/truncated payload
// and queues it regardless of the error type.
must(!furnitureLayer.includes('enqueueOfflineCreate'), 'FurnitureLayer no longer synthesizes its own offline-queue fallback payload');
must(furnitureLayer.includes('api.createFurniture('), 'FurnitureLayer creates furniture through the canonical floorApi producer');
must(furnitureLayer.includes('isOfflineQueued('), 'FurnitureLayer distinguishes offline-queued from a real (4xx) failure');

// FloorPlanPanel must recognize offline_queued as deferred success, not a
// generic create failure that invites a duplicate retry (#475).
must(floorPlanPanel.includes('isOfflineQueued(error)'), 'FloorPlanPanel recognizes offline_queued from createFloorPlan');
must(floorPlanPanel.includes('notifyOfflineQueued'), 'FloorPlanPanel surfaces a queued-not-failed message for uploadPlan');

// --- #442/#468/#475: backend contract --------------------------------------

must(floorPlansEndpoint.includes('client_request_id: str | None'), 'backend floor-plan/pin/furniture schemas accept a request id');
must(
  floorPlanService.includes('FLOOR_PLAN_CREATE_SCOPE = "floor_plan.create"') &&
    floorPlanService.includes('FURNITURE_CREATE_SCOPE = "furniture.create"') &&
    floorPlanService.includes('PIN_UPSERT_SCOPE = "floor_plan_pin.upsert"'),
  'backend has stable scopes for floor-plan create, furniture create and pin upsert',
);
must(
  floorPlanService.includes('replay_entity_id(') && floorPlanService.includes('commit_client_write('),
  'floor-plan/furniture create and pin upsert replay before an atomic commit',
);
must(
  floorPlansEndpoint.includes('"idempotency_conflict"'),
  'floor-plan endpoints surface a typed conflict for a reused id with a different payload',
);
must(idempotency.includes('class IdempotencyConflict'), 'shared idempotency ledger defines IdempotencyConflict');

// --- #377: ACL binding contract --------------------------------------------

must(
  floorPlansEndpoint.includes('FloorPlanPin.id == pin_id, FloorPlanPin.floor_plan_id == plan_id'),
  'pin PATCH resolves the pin by (pin_id, floor_plan_id) after binding the plan to the path project',
);
must(
  floorPlanService.includes('furniture_room_not_found') && floorPlanService.includes('furniture_floor_plan_not_found'),
  'furniture create validates room_id/floor_plan_id against the path project',
);

console.log('floorPlanReplayIdempotency.test.ts: all assertions passed');
