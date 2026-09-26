/**
 * Что сказать, когда список работ пуст.
 *
 * Прежде подсказка показывалась только при «нестандартном» фильтре, а
 * «Этапов пока нет» — только когда этапов нет совсем. Случай «этапы есть, но
 * ни один не попал в текущий фильтр» не покрывал никто: у заказчика фильтр по
 * умолчанию «Сейчас», и стоило единственному активному этапу просрочиться —
 * он уходил в «Проблемы», а экран оставался пустым и молчал.
 */
export type WorksEmptyState = {
  title: string;
  hint: string;
  /** Куда увести: фильтр со всеми работами. */
  showAll: boolean;
  /** Сброс к фильтру по умолчанию имеет смысл, только если он не текущий. */
  showReset: boolean;
};

export function buildWorksEmptyState(input: {
  filterLabel: string;
  query: string;
  totalStages: number;
  /** Сколько работ в «Все» — столько человек увидит, нажав «Показать все». */
  allCount?: number;
  isDefaultFilter: boolean;
}): WorksEmptyState | null {
  const { filterLabel, totalStages, isDefaultFilter } = input;
  const query = input.query.trim();
  if (totalStages === 0) return null; // пустой проект — это другое состояние

  if (query) {
    return {
      title: `Ничего не нашлось по запросу «${query}»`,
      hint: 'Проверьте написание или очистите поиск — этапы никуда не делись.',
      showAll: true,
      showReset: true,
    };
  }

  const all = input.allCount;
  const where = typeof all === 'number' && all > 0
    ? `Работы есть — их ${all} в фильтре «Все».`
    : 'Работы есть, но в другом фильтре.';

  return {
    title: `В фильтре «${filterLabel}» пока пусто`,
    hint: where,
    showAll: true,
    showReset: !isDefaultFilter,
  };
}
