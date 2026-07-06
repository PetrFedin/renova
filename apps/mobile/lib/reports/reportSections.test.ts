import { buildReportPdfQuery, DEFAULT_FINAL_SECTIONS, EXPENSE_CATEGORIES } from './reportSections';

const q = buildReportPdfQuery(['summary', 'expenses'], ['materials', 'labor']);
if (!q.includes('sections=') || !q.includes('summary') || !q.includes('expenses')) throw new Error('sections query');
if (!q.includes('categories=') || !q.includes('materials')) throw new Error('categories query');
if (buildReportPdfQuery(DEFAULT_FINAL_SECTIONS, EXPENSE_CATEGORIES.map((c) => c.id)) !== '') {
  throw new Error('full export no query');
}

console.log('reportSections.test OK');
