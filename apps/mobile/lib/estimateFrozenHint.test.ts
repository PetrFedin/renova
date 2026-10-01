import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const mobile = join(__dirname, '..');
const read = (p: string) => readFileSync(join(mobile, p), 'utf8');
const must = (c: boolean, m: string) => { if (!c) throw new Error(m); };

const hint = read('lib/estimateFrozenHint.ts');
must(hint.includes('Смета зафиксирована и не пересчитана. Чтобы учесть изменение объёма работ, оформите допработу'), 'frozen message text');
must(hint.includes('changeOrderEstimateRoute(role)'), 'frozen hint links to the change-order layer');
must(hint.includes('estimate_frozen?: unknown'), 'frozen flag read from response');

const detail = read('components/screens/RoomDetailScreen.tsx');
must(detail.includes('isEstimateFrozen(saved)') && detail.includes('alertEstimateFrozen('), 'room screen reacts to estimate_frozen');
must(detail.includes('Размеры разошлись со сметой'), 'room screen shows a divergence warning');

const list = read('components/screens/OsRoomsScreen.tsx');
must(list.includes('isEstimateFrozen(approved)'), 'approval of a room request surfaces estimate_frozen');
must(list.includes('Запросить новую комнату') && list.includes('requestMode'), 'customer can request a new room');
must(read('lib/api/types/room.ts').includes('room_id: string | null'), 'request type allows add-room (null room_id)');

const api = read('lib/api/rooms.ts');
must(api.includes('createRoomChangeRequest') && api.includes("createClientRequestId('room-change-request')"), 'request creation stays idempotent');
console.log('estimateFrozenHint ok');
