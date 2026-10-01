import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const repo = join(__dirname, '..', '..', '..');
const must = (c: boolean, m: string) => { if (!c) throw new Error(m); };

const entities = readFileSync(join(repo, 'backend/app/models/entities.py'), 'utf8');
const block = entities.match(/class WasteOrderStatus\(str, enum\.Enum\):([\s\S]*?)\n\n/);
must(!!block, 'WasteOrderStatus enum found in backend');
const backend = new Set([...block![1].matchAll(/^\s+(\w+) = "/gm)].map((m) => m[1]));
must(backend.has('scheduled') && backend.has('done'), 'backend enum parsed');

const ui = readFileSync(join(__dirname, '../components/renova/WasteOrderList.tsx'), 'utf8');
const policySrc = readFileSync(join(__dirname, 'domain/wasteOrderPolicy.ts'), 'utf8');
const used = [...policySrc.matchAll(/\bstatus\s*===\s*'(\w+)'/g)].map((m) => m[1]);
must(used.length > 0, 'wasteOrderPolicy compares statuses');
for (const s of used) must(backend.has(s), `WasteOrderList uses unknown waste status '${s}'`);
// «Вывезено» — только по wasteActions (исполнитель/self-managed заказчик, статус scheduled).
must(/act\.complete/.test(ui), 'complete button gated by wasteActions');
const policy = policySrc;
must(/complete: executor && status === 'scheduled'/.test(policy), 'complete only from scheduled');

console.log('wasteOrderStatus.test.ts ok');
