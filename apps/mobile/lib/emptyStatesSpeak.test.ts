/**
 * Пустой раздел должен сказать, что он пуст.
 *
 * Аудит заявил «37 файлов при пустом списке возвращают null — раздел молча
 * исчезает». Проверка каждого показала другое: почти везде пустоту
 * обрабатывает родитель, и «return null» внутри дочернего компонента как раз
 * правильный — иначе получилось бы два пустых состояния подряд.
 *
 * Настоящий дефект нашёлся один: лента действий рисовала заголовок «Архив
 * действий», строку чипов-фильтров — и пустоту под ними. Хуже всего с
 * фильтром: человек сузил выборку, ничего не увидел и решил, что сломалось.
 *
 * Здесь закреплено и исправление, и то, что уже было сделано правильно, —
 * чтобы будущая правка не убрала пустое состояние у родителя, оставив
 * дочерний «return null» один на один с пользователем.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const mobile = join(import.meta.dirname, '..');
const src = (path: string) => readFileSync(join(mobile, path), 'utf8');

// --- исправленное -------------------------------------------------------------

const feed = src('components/renova/ActivityFeed.tsx');

assert.ok(
  feed.includes('items.length === 0'),
  'лента действий снова рисует заголовок и пустоту под ним',
);
assert.ok(
  feed.includes('По этому фильтру ничего нет'),
  'пустой результат фильтра неотличим от «событий не было»',
);
assert.ok(
  /actionLabel="Показать все"/.test(feed) && /setKind\(''\)/.test(feed),
  'из пустого фильтра нет выхода — человек остаётся с пустым экраном',
);
assert.ok(
  feed.includes('Событий по объекту пока нет'),
  'нет текста для случая, когда событий действительно не было',
);

// --- проверенное и признанное исправным ---------------------------------------
// Дочерний `return null` безопасен ровно до тех пор, пока пустоту показывает
// родитель. Эти пары проверены чтением; тест держит их вместе.

const pairs: { child: string; parent: string; marker: string; why: string }[] = [
  {
    child: 'components/renova/UnifiedExpenseList.tsx',
    parent: 'components/screens/budget/BudgetExpensesSection.tsx',
    marker: 'emptyLabel(filter)',
    why: 'траты: родитель пишет текст с учётом выбранного фильтра',
  },
  {
    child: 'components/renova/PurchaseList.tsx',
    parent: 'components/screens/OsMaterialsScreen.tsx',
    marker: 'Закупок пока нет',
    why: 'закупки: родитель объясняет следующий шаг',
  },
  {
    child: 'components/renova/schedule/SchedulePlanItems.tsx',
    parent: 'components/screens/schedule/UnifiedScheduleView.tsx',
    marker: '(schedule.items?.length ?? 0) > 0',
    why: 'план-график: родитель не монтирует блок без пунктов',
  },
];

for (const pair of pairs) {
  assert.ok(
    src(pair.child).includes('return null'),
    `${pair.child}: дочерний компонент перестал полагаться на родителя`,
  );
  assert.ok(
    src(pair.parent).includes(pair.marker),
    `${pair.why} — родитель больше не показывает пустое состояние (${pair.parent})`,
  );
}

// --- вкладка «Отклонения» пустой не бывает ------------------------------------
// Аудит назвал её пустой; на деле аналитика рендерится безусловно.

const deviations = src('components/screens/budget/BudgetDeviationsSection.tsx');
assert.ok(
  /<ProjectAnalyticsPanel full \/>/.test(deviations),
  'вкладка «Отклонения» лишилась безусловной аналитики и стала действительно пустой',
);

console.log('emptyStatesSpeak.test OK');
