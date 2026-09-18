/**
 * По цели можно попасть пальцем.
 *
 * Минимум по гайдлайну — 44 pt. Два места были заметно меньше.
 *
 * Ссылки на экране этапа: шесть переходов в столбик, каждый высотой 26 pt
 * (18 текста + 4 + 4) и вплотную друг к другу — сплошная полоса, промах
 * уводил в соседний раздел.
 *
 * Матрица «этапы × комнаты»: строка давала 56 pt (12 + 32 + 12), но
 * нажималась только середина — 32 pt ячейки с мёртвыми зонами по 12 сверху
 * и снизу. Плюс ячейки стояли вплотную: промах по границе включал не ту
 * комнату в не тот этап.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const mobile = join(import.meta.dirname, '..');
const src = (path: string) => readFileSync(join(mobile, path), 'utf8');

// --- ссылки этапа -------------------------------------------------------------

const links = src('components/screens/stage/StageDetailLinks.tsx');

assert.ok(
  /linkRow: \{ minHeight: RenovaTheme\.minTouch/.test(links),
  'строки-ссылки этапа снова ниже минимальной зоны нажатия',
);
const rows = (links.match(/style=\{s\.linkRow\}/g) || []).length;
assert.equal(
  rows,
  6,
  `не все переходы получили полноценную строку: ${rows} из 6`,
);

// --- матрица этапов и комнат ---------------------------------------------------

const matrix = src('components/renova/StageRoomMatrix.tsx');

assert.ok(
  /minHeight: RenovaTheme\.minTouch/.test(matrix),
  'ячейка матрицы снова 32 pt — нажимается только середина строки',
);
assert.ok(
  /const CELL_GAP = (\d+);/.test(matrix),
  'зазор между ячейками матрицы задан не одним числом',
);
// Зазор должен стоять и в строке, и в шапке — иначе колонки разъедутся.
assert.ok(
  /row: \{[^}]*gap: CELL_GAP/.test(matrix),
  'ячейки матрицы снова стоят вплотную',
);
assert.ok(
  /header: \{[^}]*gap: CELL_GAP/.test(matrix),
  'шапка матрицы без того же зазора — подписи колонок съедут относительно ячеек',
);
// Высота строки не должна вырасти вдвое: паддинг строки уменьшен.
assert.ok(
  /row: \{[^}]*paddingVertical: 4/.test(matrix),
  'строка матрицы сохранила прежний вертикальный паддинг поверх новой высоты ячейки',
);

console.log('targetsBigEnoughToHit.test OK');
