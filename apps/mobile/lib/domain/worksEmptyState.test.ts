import { buildWorksEmptyState } from './worksEmptyState';

// Пустой проект — состояние «Этапов пока нет», не наше дело.
if (buildWorksEmptyState({ filterLabel: 'Сейчас', query: '', totalStages: 0, isDefaultFilter: true }) !== null) {
  throw new Error('пустой проект обрабатывается отдельно');
}

// Главный случай: фильтр по умолчанию, работы есть, но не здесь.
const now = buildWorksEmptyState({ filterLabel: 'Сейчас', query: '', totalStages: 8, allCount: 8, isDefaultFilter: true })!;
if (!now) throw new Error('пустой фильтр обязан говорить');
if (now.title !== 'В фильтре «Сейчас» пока пусто') throw new Error(`заголовок: ${now.title}`);
if (now.hint !== 'Работы есть — их 8 в фильтре «Все».') throw new Error(`подсказка: ${now.hint}`);
if (!now.showAll) throw new Error('нужна кнопка «Показать все»');
if (now.showReset) throw new Error('сброс к текущему же фильтру бессмыслен');

// Не по умолчанию — сброс уместен.
const problems = buildWorksEmptyState({ filterLabel: 'Проблемы', query: '', totalStages: 8, allCount: 8, isDefaultFilter: false })!;
if (!problems.showReset) throw new Error('сброс нужен, если фильтр выбран вручную');

// Количество неизвестно — не выдумываем число.
const unknown = buildWorksEmptyState({ filterLabel: 'Сейчас', query: '', totalStages: 3, isDefaultFilter: true })!;
if (unknown.hint !== 'Работы есть, но в другом фильтре.') throw new Error(`без счётчика: ${unknown.hint}`);

// Поиск — своя формулировка, про написание, а не про фильтры.
const search = buildWorksEmptyState({ filterLabel: 'Все', query: '  плитк  ', totalStages: 8, allCount: 8, isDefaultFilter: false })!;
if (search.title !== 'Ничего не нашлось по запросу «плитк»') throw new Error(`поиск: ${search.title}`);
if (!search.hint.includes('никуда не делись')) throw new Error('поиск обязан успокоить, а не намекать на пустоту');
if (!search.showReset || !search.showAll) throw new Error('из поиска нужны оба выхода');

console.log('worksEmptyState.test OK');
