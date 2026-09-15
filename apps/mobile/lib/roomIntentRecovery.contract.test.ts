import { readFileSync } from 'fs';
import { join } from 'path';

const mobile = join(__dirname, '..');
const source = readFileSync(join(mobile, 'lib/api/rooms.ts'), 'utf8');

const must = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message);
};

function sliceBetween(start: string, end: string): string {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  if (from < 0 || to < 0 || to <= from) {
    throw new Error(`rooms API contract markers missing: ${start} -> ${end}`);
  }
  return source.slice(from, to);
}

const createRoom = sliceBetween('createRoom: async', 'roomSnapshot:');
must(
  createRoom.includes("client_request_id: input.client_request_id ?? createClientRequestId('room')"),
  'room create must attach a stable client request id before the first POST',
);
must(createRoom.includes('const serialized = JSON.stringify(requestBody);'), 'room create serializes the identified intent once');
must(
  createRoom.includes("{ method: 'POST', body: serialized }")
    && createRoom.includes('body: serialized,'),
  'room create must send and queue the exact same identified body',
);
const roomIdAt = createRoom.indexOf("createClientRequestId('room')");
const serializedAt = createRoom.indexOf('const serialized = JSON.stringify(requestBody);');
const requestAt = createRoom.indexOf("return await req<Room>");
const enqueueAt = createRoom.indexOf('await enqueue({');
must(
  roomIdAt >= 0 && serializedAt > roomIdAt && requestAt > serializedAt && enqueueAt > requestAt,
  'room create identity must be fixed before request/queue branching',
);

const roomChange = sliceBetween('createRoomChangeRequest: async', 'approveRoomChange: async');
must(
  roomChange.includes("client_request_id: input.client_request_id ?? createClientRequestId('room-change')"),
  'room-change request must attach a stable client request id before the first POST',
);
must(roomChange.includes('const serialized = JSON.stringify(requestBody);'), 'room-change request serializes the identified intent once');
must(
  roomChange.includes("{ method: 'POST', body: serialized }")
    && roomChange.includes('body: serialized'),
  'room-change request must send and queue the exact same identified body',
);
const changeIdAt = roomChange.indexOf("createClientRequestId('room-change')");
const changeSerializedAt = roomChange.indexOf('const serialized = JSON.stringify(requestBody);');
const changeRequestAt = roomChange.indexOf('return await req(');
const changeEnqueueAt = roomChange.indexOf('await enqueue({');
must(
  changeIdAt >= 0
    && changeSerializedAt > changeIdAt
    && changeRequestAt > changeSerializedAt
    && changeEnqueueAt > changeRequestAt,
  'room-change identity must be fixed before request/queue branching',
);

console.log('roomIntentRecovery.contract.test OK');
