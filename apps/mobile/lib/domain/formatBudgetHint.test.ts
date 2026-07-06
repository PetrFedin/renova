import { formatBudgetKpiTileHint } from './formatBudgetHint';

const hint = formatBudgetKpiTileHint(164886, 404000);
if (!hint.includes('осталось') || !hint.includes('смотреть план')) throw new Error('kpi tile hint');

console.log('formatBudgetHint.test OK');
