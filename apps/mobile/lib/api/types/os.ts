/** OS: инсайты, риски, бюджет-сводка, активность */
export type OsInsight = {
  id: string;
  kind: string;
  title: string;
  body: string;
  probability?: number | null;
  action: string;
  href: string;
  priority: number;
};

export type OsScheduleSummary = {
  current_stage?: string | null;
  current_stage_id?: string | null;
  planned_end?: string | null;
  forecast_end?: string | null;
  forecast_delay_days: number;
  max_delay_days: number;
  overdue_count: number;
  progress_percent: number;
  remaining_works: number;
  risk_level: string;
  risk_score: number;
  items: { id: string; kind: string; title: string; date?: string | null; status?: string; delay_days?: number; stage_id?: string }[];
};

export type OsRisk = {
  id: string;
  kind: string;
  severity: string;
  title: string;
  cause: string;
  impact: string;
  action: string;
  href: string;
};

export type OsBudgetSummary = {
  budget_planned: number;
  budget_spent: number;
  reserve: number;
  deviation: number;
  deviation_pct: number;
  forecast_total: number;
  forecast_over: number;
  risk: string;
  remaining: number;
  segments: Record<string, { planned: number; actual: number }>;
  /** W71: доп. работы — связь с планом бюджета */
  change_orders?: {
    id: string;
    title: string;
    amount: number;
    status: string;
    description?: string;
  }[];
  change_orders_approved_sum?: number;
};

export type OsExpense = {
  id: string;
  title: string;
  category: string;
  amount: number;
  status: string;
  expense_date?: string | null;
  room_id?: string | null;
  stage_id?: string | null;
  /** W56: связанная закупка — факт материалов с сервера */
  purchase_id?: string | null;
  material_pick_id?: string | null;
  receipt_id?: string | null;
  payment_id?: string | null;
};

export type OsReport = Record<string, unknown>;

export type ActivityItem = {
  id: string;
  kind: string;
  title: string;
  body?: string | null;
  work_type?: string | null;
  room_id?: string | null;
  link_path?: string | null;
  at: string;
};

export type ProjectIssue = {
  id: string;
  title: string;
  description?: string | null;
  severity: string;
  status: string;
  room_id?: string | null;
  stage_id?: string | null;
  due_at?: string | null;
  floor_plan_id?: string | null;
  x_pct?: number | null;
  y_pct?: number | null;
  photo_key?: string | null;
  photo_url?: string | null;
};
