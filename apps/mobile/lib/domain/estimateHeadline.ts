/**
 * Что показывать крупно на экране сметы — и как это назвать.
 *
 * Под подписью «Итого по смете» стоял `project.budget_planned`, а это
 * **смета плюс одобренные доп. работы** (`sync_project_budget_planned` на
 * сервере). Строкой ниже — «Работы X · Материалы Y» из строк сметы. На
 * демо-объекте это давало 194 438 ₽ сверху и 185 938 ₽ в разбивке: разрыв
 * 8 500 ₽, ничем не объяснённый, на том самом экране, где нажимают
 * «Согласовать и зафиксировать смету».
 *
 * Само число верное — неверна подпись к нему. Здесь решается, как назвать
 * итог и нужно ли показывать слагаемое отдельно.
 */

export type EstimateHeadline = {
  /** Крупное число. */
  total: number;
  /** Подпись под ним — честная относительно состава. */
  label: string;
  /** Сумма одобренных доп. работ, если она есть в итоге. */
  changeOrders: number | null;
};

const LABEL_ESTIMATE_ONLY = 'Итого по смете';
const LABEL_WITH_CHANGE_ORDERS = 'Итого по договору';

export function estimateHeadline(input: {
  /** Сумма строк сметы — то же, что в разбивке под числом. */
  estimateTotal: number;
  /** `project.budget_planned` — смета плюс одобренные доп. работы. */
  budgetPlanned: number;
  /** Явное слагаемое с сервера. `undefined` — сервер его не прислал. */
  approvedChangeOrders?: number | null;
}): EstimateHeadline {
  const { estimateTotal, budgetPlanned } = input;
  const declared = input.approvedChangeOrders;

  // Сервер прислал слагаемое — берём его, а не выводим вычитанием.
  if (typeof declared === 'number' && declared > 0) {
    return { total: budgetPlanned, label: LABEL_WITH_CHANGE_ORDERS, changeOrders: declared };
  }
  if (typeof declared === 'number') {
    // Явный ноль: доп. работ нет, итог — это смета.
    return { total: estimateTotal, label: LABEL_ESTIMATE_ONLY, changeOrders: null };
  }

  // Сервер старой версии слагаемое не отдаёт. Расхождение всё равно нельзя
  // прятать: показываем итог как есть и не обещаем, что это только смета.
  const gap = Math.round((budgetPlanned - estimateTotal) * 100) / 100;
  if (Math.abs(gap) >= 1) {
    return { total: budgetPlanned, label: LABEL_WITH_CHANGE_ORDERS, changeOrders: null };
  }
  return { total: estimateTotal, label: LABEL_ESTIMATE_ONLY, changeOrders: null };
}
