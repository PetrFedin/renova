/** Типы JSON-отчётов Renova OS */

export type ExpenseCategoryRow = {
  category: string;
  label: string;
  total: number;
};

export type FinalReport = {
  project_name?: string;
  budget_planned?: number;
  budget_spent?: number;
  savings?: number;
  overrun?: number;
  forecast_total?: number;
  works?: { name: string; status: string; amount?: number }[];
  expenses_count?: number;
  expenses_total?: number;
  expenses_by_category?: ExpenseCategoryRow[];
  issues_total?: number;
  issues_open?: number;
  risks_remaining?: number;
  risks?: { title?: string; impact?: string }[] | Record<string, unknown>[];
};

export type DailyReport = {
  date?: string;
  expenses_today?: number;
  done_today?: string[];
  planned_tomorrow?: string[];
  expense_items?: Record<string, unknown>[];
  risks?: Record<string, unknown>[];
};

export type WeeklyReport = {
  progress_percent?: number;
  open_issues_count?: number;
  overdue_works?: string[];
  highlights?: string[];
  budget?: { budget_planned?: number; budget_spent?: number };
};
