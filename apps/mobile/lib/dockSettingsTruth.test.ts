/**
 * Экран настройки нижней панели показывал не ту панель, что на экране.
 *
 * Пока объект настраивается, `OsDockBar` берёт набор из
 * `resolveDynamicDockItems` и сохранённые настройки не применяет вовсе.
 * `DockBarSettings` при этом рисовал предпросмотр по сохранённым настройкам:
 * на одном экране одновременно были «Ремонт · Деньги» в предпросмотре и
 * «Смета · Исполнитель» в живой панели внизу. Переключатель отвечал «Панель
 * обновлена», и панель не менялась.
 *
 * Проверка требует, чтобы оба экрана считали состав панели одним и тем же
 * вызовом — тогда они не разойдутся снова.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DOCK_PRESET_SETUP,
  DOCK_PRESET_REPAIR,
  DOCK_OPTIONAL,
  DOCK_MANDATORY,
} from '@/constants/dockBar';

function stripComments(input: string): string {
  return input.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const dir = join(__dirname, '../components/renova/os');
const settings = stripComments(readFileSync(join(dir, 'DockBarSettings.tsx'), 'utf8'));
const bar = stripComments(readFileSync(join(dir, 'OsDockBar.tsx'), 'utf8'));

// 1. Оба берут состав из одного расчёта.
for (const [name, src] of [['DockBarSettings', settings], ['OsDockBar', bar]] as const) {
  if (!src.includes('resolveDynamicDockItems(')) {
    throw new Error(`${name} не спрашивает действующий состав панели — предпросмотр разойдётся с экраном`);
  }
}

// 2. Предпросмотр рисуется по действующему составу, а не по сохранённому.
if (/<DockPreview selected=\{selected\}/.test(settings)) {
  throw new Error('предпросмотр снова рисуется по сохранённым настройкам, а не по тому, что в панели');
}
if (!/<DockPreview selected=\{effective\}/.test(settings)) {
  throw new Error('предпросмотр должен рисоваться по действующему составу');
}

// 3. Когда набор подставляется автоматически, это сказано на экране.
if (!settings.includes('autoItems ? (')) {
  throw new Error('нет пояснения, что набор сейчас подставляется автоматически');
}

// 3a. Пояснение не должно отсылать к «Подробно» в «Вид главной»: этот заголовок
//     принадлежит другому переключателю — набору виджетов главной. Уровень
//     детализации, от которого зависит панель, ставится один раз в квизе при
//     первом входе, и ни один смонтированный экран его больше не меняет.
if (settings.includes('«Подробно» в «Вид главной»')) {
  throw new Error('пояснение отсылает к переключателю, который панель не меняет');
}

// 4. Подтверждение не обещает изменения панели, когда её состав не наш.
if (/title: 'Панель обновлена',\s*message: `«\$\{DOCK_BY_ID\[replaced\]/.test(settings)) {
  throw new Error('подтверждение снова безусловно обещает «Панель обновлена»');
}
if (!settings.includes("autoItems ? 'Набор сохранён' : 'Панель обновлена'")) {
  throw new Error('подтверждение должно различать сохранение набора и изменение панели');
}

// 5. Автоматический набор содержит разделы, которых нет в списке настройки, —
//    поэтому показать его сохранёнными настройками нельзя в принципе.
const configurable = new Set<string>([...DOCK_MANDATORY, ...DOCK_OPTIONAL]);
const unreachable = DOCK_PRESET_SETUP.filter((id) => !configurable.has(id));
if (!unreachable.length) {
  throw new Error(
    'набор настройки стал выразим через переключатели — проверка потеряла смысл, пересмотрите её',
  );
}
if (DOCK_PRESET_REPAIR.some((id) => !configurable.has(id))) {
  // Не ошибка сама по себе, но тогда и «ремонтный» набор нельзя показать
  // переключателями — пояснение должно покрывать оба случая.
  if (!settings.includes('autoItems ? (')) throw new Error('пояснение не покрывает ремонтный набор');
}

console.log('dockSettingsTruth.test OK  (недостижимые переключателями разделы: ' + unreachable.join(', ') + ')');
