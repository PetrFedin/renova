import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const repo = join(__dirname, '..', '..', '..');
const must = (c: boolean, m: string) => { if (!c) throw new Error(m); };

const entities = readFileSync(join(repo, 'backend/app/models/entities.py'), 'utf8');
const block = entities.match(/class StageStatus\(str, enum\.Enum\):([\s\S]*?)\n\n/);
must(!!block, 'StageStatus enum found in backend');
const backend = new Set([...block![1].matchAll(/^\s+(\w+) = "/gm)].map((m) => m[1]));
must(backend.size === 4 && !backend.has('rework'), 'rework is a flag (needs_rework), not a StageStatus');

for (const f of [
  '../components/screens/control/ContractorControlView.tsx',
  '../components/screens/control/CustomerControlView.tsx',
  './domain/buildProjectOsSnapshot.ts',
]) {
  const src = readFileSync(join(__dirname, f), 'utf8');
  for (const m of src.matchAll(/\bs\.status\s*[!=]==\s*'(\w+)'/g)) {
    must(backend.has(m[1]), `${f}: unknown stage status '${m[1]}'`);
  }
  must(src.includes('s.needs_rework'), `${f}: rework derives from needs_rework`);
}

console.log('stageReworkStatus.test.ts ok');
