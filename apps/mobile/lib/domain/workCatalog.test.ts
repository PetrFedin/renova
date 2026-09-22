import {
  addCustomWork,
  buildStageDrafts,
  catalogCategories,
  filterWorkCatalog,
  isCustomWorkCode,
  toggleWorkSelection,
  workCategoryLabel,
  type WorkCatalogItem,
} from './workCatalog';

const catalog: WorkCatalogItem[] = [
  { code: 'cleaning_final', name: 'Финальная уборка', category: 'logistics' },
  { code: 'painting', name: 'Покраска', category: 'finish' },
  { code: 'demolition', name: 'Демонтаж', category: 'prep' },
  { code: 'electrical', name: 'Электрика', category: 'engineering' },
  { code: 'kitchen_assembly', name: 'Сборка и установка кухни', category: 'furnish' },
];

if (catalogCategories(catalog).join(',') !== 'prep,engineering,finish,furnish,logistics') {
  throw new Error('порядок категорий');
}
if (workCategoryLabel('finish') !== 'Отделка') throw new Error('подпись категории');
if (workCategoryLabel('нет такой') !== 'Прочее') throw new Error('подпись неизвестной категории');

if (filterWorkCatalog(catalog, '', null).length !== 5) throw new Error('пустой фильтр');
if (filterWorkCatalog(catalog, '', 'finish').map((i) => i.code).join() !== 'painting') {
  throw new Error('фильтр по категории');
}
if (filterWorkCatalog(catalog, 'покр', null).map((i) => i.code).join() !== 'painting') {
  throw new Error('поиск по названию');
}
if (filterWorkCatalog(catalog, 'ЭЛЕКТР', null).map((i) => i.code).join() !== 'electrical') {
  throw new Error('поиск без учёта регистра');
}
if (filterWorkCatalog(catalog, 'kitchen', null).map((i) => i.code).join() !== 'kitchen_assembly') {
  throw new Error('поиск по коду');
}
if (filterWorkCatalog(catalog, 'покраска', 'prep').length !== 0) {
  throw new Error('категория и строка должны действовать вместе');
}

const one = toggleWorkSelection([], 'painting');
if (one.join() !== 'painting') throw new Error('выбор');
if (toggleWorkSelection(one, 'painting').length !== 0) throw new Error('снятие выбора');
if (toggleWorkSelection(one, 'demolition').join() !== 'painting,demolition') throw new Error('порядок выбора');

const added = addCustomWork(catalog, '  Монтаж   ниши  ');
if (!added.ok) throw new Error('своя работа должна добавляться');
if (added.items.length !== 6) throw new Error('своя работа не попала в список');
const custom = added.items[5];
if (custom.name !== 'Монтаж ниши') throw new Error('пробелы не схлопнуты');
if (!custom.custom || !isCustomWorkCode(custom.code)) throw new Error('признак своей работы');

const empty = addCustomWork(catalog, '   ');
if (empty.ok) throw new Error('пустая строка не работа');

const tooLong = addCustomWork(catalog, 'о'.repeat(65));
if (tooLong.ok) throw new Error('слишком длинное название');

const duplicate = addCustomWork(catalog, 'покраска');
if (!duplicate.ok) throw new Error('дубликат — не ошибка');
if (duplicate.items.length !== 5 || duplicate.code !== 'painting') {
  throw new Error('дубликат должен указывать на работу из каталога');
}

const drafts = buildStageDrafts(added.items, ['cleaning_final', custom.code, 'demolition', 'painting']);
if (drafts.map((d) => d.name).join(' | ') !== 'Демонтаж | Покраска | Финальная уборка | Монтаж ниши') {
  throw new Error(`порядок этапов: ${drafts.map((d) => d.name).join(' | ')}`);
}
if (drafts[0].work_type !== 'demolition') throw new Error('код работы каталога');
if (drafts[3].work_type !== 'custom') throw new Error('своя работа уходит как custom');
if (buildStageDrafts(catalog, []).length !== 0) throw new Error('без выбора этапов нет');

console.log('workCatalog.test OK');
