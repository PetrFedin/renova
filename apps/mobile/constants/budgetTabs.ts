/** Канонические вкладки «Деньги» — 4 таба + миграция legacy deep links */
import type { HubTab } from '@/components/renova/os/OsHubTabs';

export type BudgetTab = 'summary' | 'expenses' | 'payments' | 'deviations';

export const BUDGET_TAB_IDS = ['summary', 'expenses', 'payments', 'deviations'] as const;

export type ExpenseView = 'list' | 'rooms' | 'stages';

export const BUDGET_HUB_TABS: HubTab[] = [
  { id: 'summary', label: 'Сводка' },
  { id: 'expenses', label: 'Расходы' },
  { id: 'payments', label: 'Оплаты' },
  { id: 'deviations', label: 'Отклонения' },
];

/** rooms/stages/analytics → новые вкладки (aliases на 1 релиз) */
export function normalizeBudgetTab(tab: string | undefined): { tab: BudgetTab; view?: ExpenseView } {
  if (!tab) return { tab: 'summary' };
  if (tab === 'rooms') return { tab: 'expenses', view: 'rooms' };
  if (tab === 'stages') return { tab: 'expenses', view: 'stages' };
  if (tab === 'analytics') return { tab: 'deviations' };
  if ((BUDGET_TAB_IDS as readonly string[]).includes(tab)) return { tab: tab as BudgetTab };
  return { tab: 'summary' };
}

export function budgetTabLabel(tab: string): string {
  return BUDGET_HUB_TABS.find((t) => t.id === tab)?.label
    ?? ({ rooms: 'Расходы', stages: 'Расходы', analytics: 'Отклонения' } as Record<string, string>)[tab]
    ?? tab;
}
