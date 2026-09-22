/**
 * Экран вывоза мусора сверяется со статусами, которые сервер действительно
 * выдаёт. Прежняя сверка с «approved» не совпадала никогда: такого значения
 * в WasteOrderStatus нет, и кнопка «Вывезено» не появлялась — заявка
 * оставалась незакрытой навсегда.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const mobile = join(__dirname, '..');
const repo = join(mobile, '..', '..');
const src = (rel: string) => readFileSync(join(mobile, rel), 'utf8');

const entities = readFileSync(join(repo, 'backend', 'app', 'models', 'entities.py'), 'utf8');
const list = src('components/renova/WasteOrderList.tsx');
const labels = src('constants/labels.ts');
const apiSrc = src('lib/api/floor.ts');

const enumBlock = entities.split('class WasteOrderStatus')[1]?.split('\nclass ')[0] ?? '';
const serverStatuses = new Set(
  [...enumBlock.matchAll(/^\s+\w+ = "([a-z_]+)"$/gm)].map((m) => m[1]),
);
if (serverStatuses.size < 4) throw new Error(`не удалось прочитать статусы сервера: ${[...serverStatuses]}`);

const used = [...list.matchAll(/w\.status === '([a-z_]+)'/g)].map((m) => m[1]);
if (!used.length) throw new Error('экран перестал сверяться со статусом');
for (const status of used) {
  if (!serverStatuses.has(status)) {
    throw new Error(`экран ждёт статус «${status}», которого нет на сервере: ${[...serverStatuses]}`);
  }
}
if (!used.includes('scheduled')) throw new Error('после согласования заявку нельзя закрыть');

for (const status of serverStatuses) {
  if (!labels.includes(`  ${status}: '`)) {
    throw new Error(`статус «${status}» останется на экране латиницей — нет подписи`);
  }
}
if (!list.includes('wasteOrderStatusLabel(w.status)')) {
  throw new Error('статус показывается сырым перечислением');
}

if (!apiSrc.includes('rejectWasteOrder')) throw new Error('нет отказа от заявки');
if (!/rejectWasteOrder[\s\S]{0,500}enqueue\(/.test(apiSrc)) {
  throw new Error('отказ не уходит в офлайн-очередь, как согласование');
}
if (!list.includes('title="Отклонить"')) throw new Error('заказчик не может отказаться');
if (!list.includes('primaryDestructive: true')) throw new Error('отказ не помечен как необратимый');

console.log('wasteOrderStatuses.test OK');
