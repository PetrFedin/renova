/**
 * #316: прямое создание наряда обязано нести ключ запроса.
 *
 * Сервер уже умеет по нему узнавать повтор, но клиент ключа не слал: при
 * потере ответа очередь отправляла тело заново, сервер видел новый запрос —
 * и создавал второй наряд.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const mobile = join(__dirname, '..');
const src = (rel: string) => readFileSync(join(mobile, rel), 'utf8');

const apiSrc = src('lib/api/workOrders.ts');
const sheet = src('components/renova/CreateWorkSheet.tsx');
const backend = readFileSync(
  join(mobile, '..', '..', 'backend', 'app', 'api', 'v1', 'work_orders.py'),
  'utf8',
);

// Сервер принимает ключ — значит клиент обязан его слать.
if (!backend.includes('client_request_id')) {
  throw new Error('сервер перестал принимать ключ запроса на создание наряда');
}

const block = apiSrc.split('createWorkOrder')[1]?.split('patchWorkOrder')[0] ?? '';
if (!block.includes('client_request_id')) throw new Error('создание наряда идёт без ключа запроса');
if (!block.includes('createClientRequestId(')) throw new Error('ключ не создаётся, если его не дали');

// Тело должно сериализоваться один раз: иначе в очередь уйдёт другой текст.
const serializeCount = (block.match(/JSON\.stringify\(/g) || []).length;
if (serializeCount !== 1) {
  throw new Error(`тело сериализуется ${serializeCount} раз — в очередь обязан уйти тот же текст`);
}
if (!/enqueue\(\{ path, method: 'POST', body: serialized, userId \}\)/.test(block)) {
  throw new Error('в очередь уходит не та же строка тела');
}

// Ключ живёт до успеха, иначе повтор после офлайн-очереди создаст второй наряд.
if (!sheet.includes("useRef(createClientRequestId('work-order'))")) {
  throw new Error('ключ не хранится между попытками');
}
if (!sheet.includes('client_request_id: requestIdRef.current')) {
  throw new Error('форма не передаёт свой ключ');
}
const afterSuccess = sheet.split('// Наряд создан')[1]?.slice(0, 200) ?? '';
if (!afterSuccess.includes("requestIdRef.current = createClientRequestId('work-order')")) {
  throw new Error('ключ не обновляется после успеха — следующая работа уедет под старым ключом');
}
const rotations = (sheet.match(/requestIdRef\.current = createClientRequestId/g) || []).length;
if (rotations !== 1) {
  throw new Error(`ключ обновляется ${rotations} раз — обновление допустимо только после успеха`);
}

console.log('workOrderCreateIdentity.test OK');
