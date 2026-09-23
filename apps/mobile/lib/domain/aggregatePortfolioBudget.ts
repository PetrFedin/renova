/** Сводка по статьям бюджета — несколько проектов */
import type { BudgetBreakdown } from '@/lib/api';

export type PortfolioCategoryRow = {
  key: string;
  label: string;
  planned: number;
  /**
   * Факт по статье. `null` — факта нет: за статьёй нет ни одной записи, или
   * у статьи факта не бывает в принципе (резерв). Раньше в это поле для работ,
   * вывоза и резерва подставлялся план — «факт» совпадал с планом просто
   * потому, что это было одно и то же число, а отклонение всегда выходило
   * нулевым и перерасход по этим статьям не мог быть обнаружен никогда.
   */
  spent: number | null;
  /** Отклонение факта от плана. `null`, когда факта нет. */
  variance: number | null;
  variancePct: number | null;
  hasOverrun: boolean;
  /** Сколько записей стоит за фактом: ноль записей — не ноль рублей. */
  factRecords: number;
  /** Почему факта нет — короткая строка для экрана. */
  factNote: string | null;
};

function categoryLine(
  key: string,
  label: string,
  planned: number,
  spent: number | null,
  factRecords: number,
  factNote: string | null,
): PortfolioCategoryRow {
  if (spent === null) {
    return { key, label, planned, spent: null, variance: null, variancePct: null, hasOverrun: false, factRecords, factNote };
  }
  const variance = spent - planned;
  return {
    key,
    label,
    planned,
    spent,
    variance,
    variancePct: planned > 0 ? Math.round((variance / planned) * 100) : 0,
    hasOverrun: planned > 0 && variance > 0,
    factRecords,
    factNote: null,
  };
}

export function aggregatePortfolioBudgetBreakdowns(breakdowns: BudgetBreakdown[]): PortfolioCategoryRow[] {
  let works = 0;
  let worksFact = 0;
  let worksRecords = 0;
  let materialsPlan = 0;
  let materialsFact = 0;
  let materialsRecords = 0;
  let waste = 0;
  let wasteFact = 0;
  let wasteRecords = 0;
  let reserve = 0;
  let totalPlan = 0;
  let totalSpent = 0;

  for (const b of breakdowns) {
    works += b.works || 0;
    worksFact += b.works_fact || 0;
    worksRecords += b.works_fact_records || 0;
    materialsPlan += b.materials_plan || 0;
    materialsFact += b.materials_fact || 0;
    // Старый сервер не присылает счётчик: факт по материалам у него уже был,
    // и молчаливый ноль записей превратил бы его в «не зафиксировано».
    materialsRecords += b.materials_fact_records ?? (b.materials_fact ? 1 : 0);
    waste += b.waste || 0;
    wasteFact += b.waste_fact || 0;
    wasteRecords += b.waste_fact_records || 0;
    reserve += b.reserve || 0;
    totalPlan += b.budget_planned || 0;
    totalSpent += b.budget_spent || 0;
  }

  const lines = [
    categoryLine('works', 'Работы', works, worksRecords > 0 ? worksFact : null, worksRecords, 'фактические объёмы не проставлены'),
    categoryLine('materials', 'Материалы', materialsPlan, materialsRecords > 0 ? materialsFact : null, materialsRecords, 'закупки не отмечены'),
    categoryLine('waste', 'Вывоз мусора', waste, wasteRecords > 0 ? wasteFact : null, wasteRecords, 'нет выполненных заказов'),
    categoryLine('reserve', 'Резерв', reserve, null, 0, 'расходуется через другие статьи'),
    categoryLine('total', 'Итого по бюджету', totalPlan, totalSpent, breakdowns.length, null),
  ];

  return lines.filter((l) => l.planned > 0 || (l.spent ?? 0) > 0);
}
