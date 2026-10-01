/** Audit closure regressions: chat/budget/schedule slice (UI-001, BUD-25, BUD-31, BUD-33, BUD-32). */
import { readFileSync } from 'fs';
import { join } from 'path';
import { buildPortfolioProjectRows } from './domain/portfolioProjects';

const mobile = join(__dirname, '..');
const src = (rel: string) => readFileSync(join(mobile, rel), 'utf8');

// UI-001: no fact -> no «Экономия» and no -100 %.
const [noFact, over, under] = buildPortfolioProjectRows([
  { id: 'a', name: 'A', budget_planned: 1_000_000, budget_spent: 0, progress_percent: 0, pending_payments: 0 },
  { id: 'b', name: 'B', budget_planned: 1_000_000, budget_spent: 1_200_000, progress_percent: 50, pending_payments: 0 },
  { id: 'c', name: 'C', budget_planned: 1_000_000, budget_spent: 500_000, progress_percent: 50, pending_payments: 0 },
] as any);
if (noFact.status !== 'on_track' || noFact.variancePct !== 0 || noFact.variance !== 0) {
  throw new Error('project without fact must not show saving/-100%');
}
if (over.status !== 'over' || under.status !== 'under') throw new Error('real variance must stay visible');
if (!/budget_spent \?\? 0\) > 0/.test(src('components/renova/BudgetBreakdown.tsx'))) {
  throw new Error('BudgetBreakdown must hide the forecast without a recorded fact');
}

// BUD-25: schedule rejection reason is typed by the customer.
const schedule = src('components/screens/schedule/UnifiedScheduleView.tsx');
if (schedule.includes("'Нужна правка сроков'")) throw new Error('hard-coded rejection reason is back');
if (!schedule.includes('rejectWorkSchedule(user.id, activeProject.id, schedule.id, reason)')) {
  throw new Error('rejection must send the typed reason');
}

// BUD-31: no «Подтвердить» button on the author's own confirm request.
if (!src('components/renova/chat/ChatThreadView.tsx').includes("m.message_type === 'confirm' && m.author_id !== user.id")) {
  throw new Error('author must not see confirm button on own request');
}

// BUD-33: chat tabs do not gate on owning a project (thread-only guests have an inbox).
for (const tab of ['app/(customer)/(tabs)/chat.tsx', 'app/(contractor)/(tabs)/chat.tsx']) {
  if (src(tab).includes('!projects.length')) throw new Error(`${tab} gates the chat list on projects`);
}

// BUD-32: truncating base64 helper is gone.
if (src('lib/compressImage.ts').includes('compressDataUrl')) throw new Error('compressDataUrl must stay removed');

console.log('auditSliceChatBudget ok');
