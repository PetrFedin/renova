/** Clarity F: Works list-row + lean budget widgets default */
import { readFileSync } from 'fs';
import { join } from 'path';
import { BUDGET_WIDGET_DEFAULT } from '../constants/budgetWidgets';

const mobile = join(__dirname, '..');
const card = readFileSync(join(mobile, 'components/renova/WorkStageCard.tsx'), 'utf8');
const works = readFileSync(join(mobile, 'components/screens/OsWorksScreen.tsx'), 'utf8');
const styles = readFileSync(join(mobile, 'components/screens/budget/budgetScreenStyles.ts'), 'utf8');
const budget = readFileSync(join(mobile, 'components/screens/budget/BudgetSummarySection.tsx'), 'utf8');

console.assert(card.includes('listRowStyles') && !card.includes('...card'), 'WorkStageCard list-row');
console.assert(works.includes('showSecondaryPanels') && works.includes('План и назначения'), 'works secondary');
console.assert(styles.includes('listRowStyles') && styles.includes('screenTypography'), 'budget styles');
console.assert(!styles.includes("textTransform: 'uppercase'"), 'budget no uppercase');
console.assert(
  BUDGET_WIDGET_DEFAULT.includes('summary_kpi') &&
    !BUDGET_WIDGET_DEFAULT.includes('repair_control') &&
    !BUDGET_WIDGET_DEFAULT.includes('segments'),
  'lean budget default',
);
console.assert(!budget.includes('title="Сводка"'), 'budget kpi no Сводка title');

const ok =
  card.includes('listRowStyles') &&
  works.includes('showSecondaryPanels') &&
  !BUDGET_WIDGET_DEFAULT.includes('repair_control');
if (!ok) process.exit(1);
console.log('clarityWaveF.w159.test OK');
