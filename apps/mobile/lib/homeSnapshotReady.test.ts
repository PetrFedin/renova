/**
 * Главная показывала «Не удалось загрузить главную» без причины при полностью
 * успешной загрузке.
 *
 * Снимок экрана считается в `useMemo`, а условие внутри читало ref с отметкой
 * «какой объект загружен». Ref не входит в зависимости и его присваивание не
 * вызывает перерисовку: отметка ставится в `finally`, уже после того как
 * `dash` разошёлся по состоянию, и memo больше не пересчитывался. Снимок
 * оставался пустым — экран уходил в ошибку, хотя данные пришли.
 *
 * Показывалось не всегда: если какой-нибудь параллельный запрос отвечал
 * позже отметки, его `setState` пересчитывал memo и снимок появлялся. То есть
 * это гонка, и на быстрых объектах она выигрывалась в пользу ошибки.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const screen = readFileSync(
  join(__dirname, '..', 'components', 'screens', 'OsHomeScreen.tsx'),
  'utf8',
);

const memoStart = screen.indexOf('const snap = useMemo(');
if (memoStart === -1) throw new Error('снимок главной больше не считается через useMemo');
const memoEnd = screen.indexOf('\n  useEffect(', memoStart);
const memo = screen.slice(memoStart, memoEnd === -1 ? memoStart + 2500 : memoEnd);

// Главное: условие сверяется с состоянием, а не с ref.
if (/loadedProjectIdRef\.current/.test(memo)) {
  throw new Error('снимок снова сверяется с ref — пересчёта не будет');
}
if (!memo.includes('loadedProjectId !== activeProject.id')) {
  throw new Error('снимок не сверяется с отметкой загруженного объекта');
}

// Отметка обязана быть в зависимостях, иначе пересчёт снова не случится.
const deps = memo.slice(memo.lastIndexOf('}, ['));
if (!deps.includes('loadedProjectId')) {
  throw new Error('отметка не попала в зависимости useMemo');
}

// Ни один ref не должен решать судьбу снимка: они не вызывают перерисовку.
const refReads = memo.match(/\w+Ref\.current/g);
if (refReads) throw new Error(`в снимке читаются ref: ${refReads.join(', ')}`);

// Отметка ставится в одном месте — иначе ref и состояние разойдутся.
if (!screen.includes('const markProjectLoaded = useCallback(')) {
  throw new Error('нет единой точки установки отметки');
}
const direct = screen.match(/loadedProjectIdRef\.current = /g) || [];
if (direct.length !== 1) {
  throw new Error(`ref присваивается в ${direct.length} местах — состояние отстанет от него`);
}

console.log('homeSnapshotReady.test OK');
