import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getAttemptKey, releaseAttemptKey, _resetAttemptKeys } from './api/attemptKey';
import { writeResultMessage, OFFLINE_SAVED_MESSAGE } from './offlineResultMessage';
import { exceedsQueueBodyLimit } from './api/queueableError';

const must = (c: boolean, m: string) => { if (!c) throw new Error(m); };
const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

// CMP-005: один ключ на попытку, новый после успеха / при другом теле.
_resetAttemptKeys();
const k1 = getAttemptKey('u', 'project-create', '{"name":"A"}');
must(getAttemptKey('u', 'project-create', '{"name":"A"}') === k1, 'retry reuses key');
must(getAttemptKey('u', 'project-create', '{"name":"B"}') !== k1, 'changed body is another attempt');
must(getAttemptKey('v', 'project-create', '{"name":"A"}') !== k1, 'other user is another attempt');
releaseAttemptKey('u', 'project-create', '{"name":"A"}');
must(getAttemptKey('u', 'project-create', '{"name":"A"}') !== k1, 'key rotates after success');
must(k1.length >= 8 && k1.length <= 80, 'key fits backend 8..80 bounds');

const projects = read('lib/api/projects.ts');
must(projects.includes('client_request_id: key') && projects.includes("'project-create'"), 'createProject sends client_request_id');

// CMP-011 / CMP-006: queued is a message, never a raw code.
must(writeResultMessage(new Error('offline_queued'), 'x') === OFFLINE_SAVED_MESSAGE, 'queued -> friendly message');
must(writeResultMessage(new Error('Сумма больше остатка'), 'x') === 'Сумма больше остатка', 'human message kept');
must(!writeResultMessage(new Error('offline_queued'), 'x').includes('offline_queued'), 'no raw code');
must(read('components/renova/CreateRoomSheet.tsx').includes('isQueuedResult(e)'), 'room sheet distinguishes queued');

// CMP-014: keys where the server supports them.
must(read('lib/api/stages.ts').includes("createClientRequestId('stage-create')"), 'createStage key');
must(read('lib/api/calendar.ts').includes("createClientRequestId('ical-import')"), 'importIcal key');

// CMP-026: 5xx is not "offline".
const payments = read('lib/api/payments.ts');
must(payments.includes('WRITE_RESPONSE_UNKNOWN') && payments.includes('e.status >= 500'), 'payment 5xx -> response unknown');
must(read('lib/api/documents.ts').includes('UPLOAD_RESPONSE_UNKNOWN'), 'upload 5xx -> response unknown');

// CMP-027/028: photo offline path and size cap.
const screen = read('components/screens/StageDetailScreen.tsx');
must(screen.includes('uploadUrlError') && screen.includes('isQueueableWriteError'), 'getUploadUrl failure falls back to queue');
must(read('lib/api/stages.ts').includes('exceedsQueueBodyLimit(queuedBody)'), 'photo queue size cap');
must(!exceedsQueueBodyLimit('x'.repeat(1000)) && exceedsQueueBodyLimit('x'.repeat(1_600_000)), 'size cap threshold');
console.log('offlineWriteCoverage.test.ts ok');
