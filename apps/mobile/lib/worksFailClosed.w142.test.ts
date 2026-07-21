/** W142: fail-closed stage deps — API error ≠ blocked:false */
import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '..');
const works = readFileSync(join(root, 'components/screens/OsWorksScreen.tsx'), 'utf8');
const materials = readFileSync(join(root, 'components/screens/OsMaterialsScreen.tsx'), 'utf8');

function must(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

must(works.includes("depends_on: 'Не удалось проверить зависимости'"), 'fail-closed message');
must(works.includes('blocked: true'), 'fail-closed blocked true');
must(!works.includes('return [s.id, { blocked: false }]'), 'no fail-open blocked false');
must(materials.includes("loadState === 'error'"), 'materials error state');
must(materials.includes('Не удалось загрузить материалы'), 'materials error copy');
must(!materials.includes(".catch(() => setPicks([]))"), 'no silent empty picks');

console.log('worksFailClosed.w142.test OK');
