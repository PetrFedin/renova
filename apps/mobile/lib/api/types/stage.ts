/** Этапы и план работ */
export type Stage = {
  id: string;
  name: string;
  sort_order: number;
  status: string;
  percent_complete: number;
  payment_amount: number;
  weight_coefficient?: number;
  display_status?: string;
  works_total?: number;
  works_done?: number;
  planned_start?: string | null;
  planned_end?: string | null;
  contractor_ready?: boolean;
  customer_accepted_at?: string | null;
  needs_rework?: boolean;
  rework_deadline?: string | null;
  work_type?: string | null;
  room_ids?: string[];
  assignee_id?: string | null;
  actual_start?: string | null;
  actual_end?: string | null;
  budget_alert_pct?: number | null;
};

export type StageChecklistItem = { id: string; text: string; done: boolean };

export type StageDetail = Stage & {
  notes: string | null;
  contractor_ready_at: string | null;
  comments: { id: string; text: string; author_role: string; created_at: string }[];
  photos: { id: string; caption: string | null; created_at: string; has_image: boolean }[];
};

export type ProjectPlan = {
  project_id: string;
  name: string;
  property_type: string;
  planned_start_date: string | null;
  planned_end_date: string | null;
  stages: StageDetail[];
};
