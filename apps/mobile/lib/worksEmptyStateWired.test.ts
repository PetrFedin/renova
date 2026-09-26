/**
 * У заказчика фильтр работ по умолчанию — «Сейчас», и он легко оказывается
 * пустым: стоит единственному активному этапу просрочиться, как он уходит в
 * «Проблемы». Экран при этом не говорил ничего — ни строки на восемь этапов.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const mobile = join(__dirname, '..');
const src = (rel: string) => readFileSync(join(mobile, rel), 'utf8');

const screen = src('components/screens/OsWorksScreen.tsx');

if (!screen.includes('buildWorksEmptyState')) throw new Error('пустое состояние не собирается');
if (screen.includes('!stages.length && hasActiveFilter')) {
  throw new Error('подсказка снова показывается только при нестандартном фильтре');
}
if (!screen.includes('{!stages.length && emptyState && (')) {
  throw new Error('подсказка не привязана к рассчитанному состоянию');
}
if (!screen.includes('const showAllStages = () => {')) throw new Error('нет отдельного «показать все»');
if (!/showAllStages = \(\) => \{\s*setFilter\('all'\);/.test(screen)) {
  throw new Error('«Показать все» обязано ставить фильтр «Все»');
}
if (!screen.includes('onPress={showAllStages}')) throw new Error('кнопка «Показать все» зовёт не то');
if (!screen.includes('`Показать все (${allStagesCount})`')) throw new Error('кнопка не называет число работ');

// Пустой проект остаётся отдельным состоянием со своим призывом к действию.
if (!screen.includes('title="Этапов пока нет"')) throw new Error('состояние пустого проекта пропало');

console.log('worksEmptyStateWired.test OK');
