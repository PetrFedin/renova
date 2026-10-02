import assert from 'node:assert/strict';
import { createFabScrollTracker, FAB_HIDE_DELTA } from './fabAutoHide';

const t = createFabScrollTracker();
assert.equal(t.isHidden(), false, 'вначале кнопка видна');
assert.equal(t.onScroll(4), false, 'у верха не прячем');
assert.equal(t.onScroll(100), true, 'прокрутка вниз прячет');
assert.equal(t.onScroll(103), true, 'микродвижение не возвращает');
assert.equal(t.onScroll(100 - FAB_HIDE_DELTA - 1), false, 'прокрутка вверх возвращает');
assert.equal(t.onScroll(300), true, 'снова вниз — прячет');
assert.equal(t.onIdle(), false, 'остановка возвращает');
assert.equal(t.onScroll(500), true);
assert.equal(t.onScroll(0), false, 'возврат к верху показывает');
t.onScroll(400);
t.reset();
assert.equal(t.isHidden(), false);
// медленная прокрутка вниз накапливается до порога
const slow = createFabScrollTracker();
slow.onScroll(100);
slow.onScroll(103);
slow.onScroll(106);
assert.equal(slow.onScroll(109), true, 'медленная прокрутка тоже прячет');
// отрицательный offset (резинка iOS) не ломает
assert.equal(createFabScrollTracker().onScroll(-30), false);
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const fab = readFileSync(join(import.meta.dirname, '../components/renova/os/OsQuickFab.tsx'), 'utf8');
assert.ok(fab.includes('subscribeFabHidden') && fab.includes("addEventListener('scroll'"), 'FAB не подписан на прокрутку');
assert.ok(!/pointerEvents=/.test(fab), 'pointerEvents как проп устарел в RN-web: используйте style');
console.log('fabAutoHide.test OK');
