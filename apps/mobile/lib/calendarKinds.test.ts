/**
 * Виды событий календаря в клиенте должны существовать на сервере.
 * Прежний фильтр для заказчика перечислял четыре несуществующих вида,
 * а настоящий старт (`stage_started`) не ловил — и отметки «Старт: …»
 * заказчику показывались, хотя скрыть их и собирались.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const mobile = join(__dirname, '..');
const repo = join(mobile, '..', '..');

const service = readFileSync(join(repo, 'backend', 'app', 'services', 'calendar_service.py'), 'utf8');
const serverKinds = new Set([...service.matchAll(/"kind":\s*"([a-z_]+)"/g)].map((m) => m[1]));
if (serverKinds.size < 5) throw new Error(`не удалось прочитать виды событий: ${[...serverKinds]}`);

const source = readFileSync(join(mobile, 'lib', 'domain', 'calendarEvents.ts'), 'utf8');
const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const used = new Set([...code.matchAll(/kind\s*(?:===|!==)\s*'([a-z_]+)'/g)].map((m) => m[1]));
for (const m of code.matchAll(/new Set\(\[([^\]]*)\]\)/g)) {
  for (const vm of m[1].matchAll(/'([a-z_]+)'/g)) used.add(vm[1]);
}
if (!used.size) throw new Error('в разборе календаря не осталось ни одного вида события');

const unknown = [...used].filter((kind) => !serverKinds.has(kind));
if (unknown.length) {
  throw new Error(`клиент ждёт виды событий, которых сервер не отдаёт: ${unknown.join(', ')}`);
}
if (!used.has('stage_started')) {
  throw new Error('настоящая отметка старта снова не учтена');
}

console.log('calendarKinds.test OK');
