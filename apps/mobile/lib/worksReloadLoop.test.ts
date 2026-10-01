/**
 * «Ремонт → Этапы» не должен перечитывать объект из обработчика шины данных.
 *
 * loadProject сам вызывает notifyProjectDataChanged; когда useProjectDataReload получал
 * refreshWorks (внутри — loadProject), экран зацикливался: ≈250 запросов /stages/:id/blocked
 * за 6 секунд и 429 на всё приложение (замер на живом стенде, 375×812).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const mobile = join(import.meta.dirname, '..');
const src = readFileSync(join(mobile, 'components/screens/OsWorksScreen.tsx'), 'utf8');

const m = src.match(/useProjectDataReload\(([A-Za-z_]+)\)/);
assert.ok(m, 'OsWorksScreen subscribes to project data changes');
const handler = m![1];
const def = src.match(new RegExp(`const ${handler} = useCallback\\(([\\s\\S]*?)\\n  \\}, \\[`));
assert.ok(def, `${handler} is defined with useCallback`);
assert.ok(!/loadProject\(/.test(def![1]), `${handler} must not call loadProject (reload loop)`);
assert.ok(!/refreshWorks\(/.test(def![1]), `${handler} must not call refreshWorks (it calls loadProject)`);

console.log('worksReloadLoop.test OK');
