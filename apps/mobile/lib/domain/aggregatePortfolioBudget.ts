/** Сводка по статьям бюджета — несколько проектов */
import type { BudgetBreakdown } from '@/lib/api';

export type PortfolioCategoryRow = {
  key: string;
  label: string;
  planned: number;
  spent: number;
  variance: number;
  variancePct: number;
  hasOverrun: boolean;
  /**
   * false — для этой категории нет независимого источника факта (например, "Резерв" —
   * расчётный остаток, а не отслеживаемая статья расходов), и spent/variance здесь не
   * измерены, а являются условной оценкой. UI не должен рисовать её как настоящее
   * отклонение (issue #318: раньше факт молча приравнивался к плану для works/waste/reserve).
   */
  factAvailable: boolean;
};

function categoryLine(
  key: string,
  label: string,
  planned: number,
  spent: number,
  factAvailable: boolean,
): PortfolioCategoryRow {
  const variance = spent - planned;
  const variancePct = planned > 0 ? Math.round((variance / planned) * 100) : 0;
  return {
    key,
    label,
    planned,
    spent,
    variance,
    variancePct,
    hasOverrun: factAvailable && planned > 0 && variance > 0,
    factAvailable,
  };
}

export function aggregatePortfolioBudgetBreakdowns(breakdowns: BudgetBreakdown[]): PortfolioCategoryRow[] {
  let works = 0;
  let worksFact = 0;
  let worksFactKnown = true;
  let materialsPlan = 0;
  let materialsFact = 0;
  let waste = 0;
  let reserve = 0;
  let totalPlan = 0;
  let totalSpent = 0;

  for (const b of breakdowns) {
    works += b.works || 0;
    if (typeof b.works_fact === 'number') {
      worksFact += b.works_fact;
    } else {
      // Старый бэкенд без works_fact — честно помечаем факт как неизвестный,
      // а не подставляем план (issue #318).
      worksFactKnown = false;
    }
    materialsPlan += b.materials_plan || 0;
    materialsFact += b.materials_fact || 0;
    waste += b.waste || 0;
    reserve += b.reserve || 0;
    totalPlan += b.budget_planned || 0;
    totalSpent += b.budget_spent || 0;
  }

  const lines = [
    categoryLine('works', 'Работы (смета)', works, worksFactKnown ? worksFact : works, worksFactKnown),
    categoryLine('materials', 'Материалы', materialsPlan, materialsFact, true),
    // "Вывоз мусора" не имеет отдельной сметы: сумма фиксируется при создании заказа
    // и одновременно является и планом, и фактом — это свойство модели данных, а не
    // заглушка, поэтому factAvailable=true (нулевой variance здесь реален, не выдуман).
    categoryLine('waste', 'Вывоз мусора', waste, waste, true),
    // "Резерв" — расчётный остаток бюджета, а не отслеживаемая статья расходов:
    // у него нет собственного факта, поэтому variance не измеряется.
    categoryLine('reserve', 'Резерв', reserve, reserve, false),
    categoryLine('total', 'Итого по бюджету', totalPlan, totalSpent, true),
  ];

  return lines.filter((l) => l.planned > 0 || l.spent > 0);
}
