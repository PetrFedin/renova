/** Проект, смета, дашборд */
import type { Room } from './room';
import type { Stage } from './stage';

export type ProjectSummary = {
  id: string;
  name: string;
  address: string | null;
  renovation_type: string;
  property_type?: string;
  /** Сумма сметы (₽) */
  budget_planned: number;
  budget_spent: number;
  progress_percent: number;
  rooms_count: number;
  stages_count: number;
  planned_start_date?: string | null;
  planned_end_date?: string | null;
  /** Лимит вложений заказчика (₽) — может отличаться от суммы сметы */
  customer_budget?: number | null;
  /** Счётов к оплате — если backend отдаёт в списке проектов */
  pending_payments?: number | null;
  /** Подключённый исполнитель */
  contractor_id?: string | null;
  is_archived?: boolean;
  trashed_at?: string | null;
};

export type EstimateLine = {
  id: string;
  line_type: string;
  name: string;
  unit: string;
  quantity_planned: number;
  quantity_actual: number;
  unit_price: number;
  room_name: string | null;
  room_id?: string | null;
  category?: string | null;
  calc_detail?: string | null;
  /** Доп. поле — бренд, артикул, условия (редактирует подрядчик) */
  notes?: string | null;
  total: number;
};

export type BudgetBreakdown = {
  works: number;
  materials_plan: number;
  materials_fact: number;
  waste: number;
  reserve: number;
  total_planned: number;
  budget_planned: number;
  budget_spent: number;
};

export type ProjectDetail = ProjectSummary & {
  read_only?: boolean;
  access_mode?: 'owner' | 'contractor' | 'guest';
  estimate_lines: EstimateLine[];
  stages: Stage[];
  rooms?: Room[];
};

export type Dashboard = {
  project_id: string;
  name: string;
  progress_percent: number;
  budget_planned: number;
  budget_spent: number;
  budget_variance_percent: number;
  days_overdue: number;
  next_action_title: string;
  next_action_type: string;
  alerts: string[];
  planned_start_date?: string | null;
  planned_end_date?: string | null;
};
