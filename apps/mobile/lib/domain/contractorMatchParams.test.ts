import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { contractorMatchParams } from './contractorMatchParams';

assert.deepEqual(contractorMatchParams(null), {});
assert.deepEqual(contractorMatchParams({ renovation_type: 'bathroom', stages: [] }), { renovationType: 'bathroom' });
assert.deepEqual(
  contractorMatchParams({ renovation_type: 'capital', stages: [{ work_type: 'tiling' }, { work_type: 'electrical' }, { work_type: 'tiling' }, { work_type: null }] }),
  { renovationType: 'capital', specialty: 'tiling' },
);
// ничья — по алфавиту, независимо от порядка
assert.equal(contractorMatchParams({ stages: [{ work_type: 'b' }, { work_type: 'a' }] }).specialty, 'a');
assert.equal(contractorMatchParams({ stages: [{ work_type: 'a' }, { work_type: 'b' }] }).specialty, 'a');

const dir = readFileSync(join(__dirname, '../../components/renova/ContractorDirectory.tsx'), 'utf8');
assert.ok(!dir.includes("'capital', 'tiling'"), 'подбор снова зашит');
assert.ok(dir.includes('contractorMatchParams('), 'каталог берёт параметры из объекта');
console.log('contractorMatchParams ok');
