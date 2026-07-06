/** Разделы финального отчёта — для in-app и частичного PDF */

export type FinalReportSectionId = 'summary' | 'works' | 'expenses' | 'risks' | 'issues';

export type ExpenseCategoryId = 'materials' | 'labor' | 'delivery' | 'tools' | 'other';

export const FINAL_REPORT_SECTIONS: { id: FinalReportSectionId; label: string; hint?: string }[] = [
  { id: 'summary', label: 'Сводка бюджета', hint: 'план · факт · экономия' },
  { id: 'works', label: 'Работы', hint: 'этапы и статусы' },
  { id: 'expenses', label: 'Расходы', hint: 'по статьям' },
  { id: 'risks', label: 'Риски', hint: 'остаточные' },
  { id: 'issues', label: 'Замечания', hint: 'открытые и закрытые' },
];

export const EXPENSE_CATEGORIES: { id: ExpenseCategoryId; label: string }[] = [
  { id: 'materials', label: 'Материалы' },
  { id: 'labor', label: 'Работы' },
  { id: 'delivery', label: 'Доставка' },
  { id: 'tools', label: 'Инструмент' },
  { id: 'other', label: 'Прочее' },
];

export const DEFAULT_FINAL_SECTIONS: FinalReportSectionId[] = FINAL_REPORT_SECTIONS.map((s) => s.id);

export function buildReportPdfQuery(sections: FinalReportSectionId[], categories: ExpenseCategoryId[]): string {
  const q = new URLSearchParams();
  if (sections.length && sections.length < DEFAULT_FINAL_SECTIONS.length) {
    q.set('sections', sections.join(','));
  }
  if (categories.length && categories.length < EXPENSE_CATEGORIES.length) {
    q.set('categories', categories.join(','));
  }
  const s = q.toString();
  return s ? `?${s}` : '';
}
