import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const mobile = join(__dirname, '..');
const repo = join(mobile, '..', '..');
const readMobile = (relativePath: string) => readFileSync(join(mobile, relativePath), 'utf8');
const readBackend = (relativePath: string) => readFileSync(join(repo, 'backend', relativePath), 'utf8');
const must = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message);
};

const roomsApi = readMobile('lib/api/rooms.ts');
const roomsEndpoint = readBackend('app/api/v1/rooms.py');
const roomRequestsEndpoint = readBackend('app/api/v1/room_requests.py');
const roomMutationService = readBackend('app/services/room_mutation_service.py');
const roomChangeService = readBackend('app/services/room_change_service.py');
const idempotency = readBackend('app/services/client_write_idempotency.py');

// --- Room create (#436 primitive 1) ---------------------------------------

const createRoomStart = roomsApi.indexOf('createRoom: async');
const createRoomEnd = roomsApi.indexOf('roomSnapshot:', createRoomStart);
const createRoomBlock = roomsApi.slice(createRoomStart, createRoomEnd);
must(createRoomStart >= 0 && createRoomEnd > createRoomStart, 'room create API block exists');
must(createRoomBlock.includes("createClientRequestId('room-create')"), 'mobile mints a stable room-create request id');
must(createRoomBlock.includes('client_request_id:'), 'mobile sends the request id with the room body');
must(createRoomBlock.includes('const requestBody = JSON.stringify('), 'mobile serializes the body once, before the first attempt');
must((createRoomBlock.match(/body: requestBody/g) || []).length === 2, 'online request and queued offline replay send the identical serialized body');

must(roomMutationService.includes('ROOM_CREATE_SCOPE = "room.create"'), 'backend has a stable room-create scope');
must(roomsEndpoint.includes('client_request_id: str | None'), 'backend room-create schema accepts a request id');
must(
  roomMutationService.includes('replay_entity_id(') && roomMutationService.includes('commit_client_write('),
  'room create replays before an atomic commit',
);
must(
  roomsEndpoint.includes('"idempotency_conflict"'),
  'room create endpoint surfaces a typed conflict for a reused id with a different payload',
);

// --- Room-change request create (#436 primitive 2) -------------------------

const createRcrStart = roomsApi.indexOf('createRoomChangeRequest: async');
const createRcrEnd = roomsApi.indexOf('approveRoomChange:', createRcrStart);
const createRcrBlock = roomsApi.slice(createRcrStart, createRcrEnd);
must(createRcrStart >= 0 && createRcrEnd > createRcrStart, 'room-change-request create API block exists');
must(createRcrBlock.includes("createClientRequestId('room-change-request')"), 'mobile mints a stable room-change-request id');
must(createRcrBlock.includes('client_request_id:'), 'mobile sends the request id with the room-change-request body');
must(createRcrBlock.includes('const requestBody = JSON.stringify('), 'mobile serializes the room-change-request body once, before the first attempt');
must((createRcrBlock.match(/body: requestBody/g) || []).length === 2, 'online request and queued offline replay send the identical serialized room-change-request body');

must(roomChangeService.includes('ROOM_CHANGE_CREATE_SCOPE = "room_change.create"'), 'backend has a stable room-change-request create scope');
must(roomRequestsEndpoint.includes('client_request_id: str | None'), 'backend room-change-request schema accepts a request id');
must(
  roomChangeService.includes('replay_entity_id(') && roomChangeService.includes('commit_client_write('),
  'room-change-request create replays before an atomic commit',
);
must(
  roomRequestsEndpoint.includes('"idempotency_conflict"'),
  'room-change-request endpoint surfaces a typed conflict for a reused id with a different payload',
);
must(
  roomRequestsEndpoint.includes('"replayed": replayed'),
  'room-change-request create response reports the real replay flag, not a hardcoded value',
);

// Shared idempotency ledger contract: same id + same payload replays; same id
// + different payload conflicts; a new id is always a distinct intent.
must(idempotency.includes('IdempotencyConflict'), 'ledger exposes a typed conflict for reused ids with a changed payload');
must(idempotency.includes('canonical_payload_hash'), 'ledger keys replay on a canonical payload hash, not on a full-payload equality check');

console.log('roomCreateIdempotency.test OK');
