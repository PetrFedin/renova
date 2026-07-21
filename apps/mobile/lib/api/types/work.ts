/** Работы, наряды, приёмка */
import type { StageChecklistItem } from './stage';
export type WorkCompletionCheck = { id: string; ok: boolean; message: string; action?: string; button?: string };

export type WorkSnapshot = {
  id: string;
  name: string;
  room_id?: string | null;
  room_name?: string | null;
  status: string;
  status_label: string;
  blocked: boolean;
  percent_complete: number;
  planned_start?: string | null;
  planned_end?: string | null;
  next_action: { title: string; button: string; kind: string; href: string };
  completion: { ok: boolean; checks: WorkCompletionCheck[]; failed: WorkCompletionCheck[] };
  checklist_progress?: { done: number; total: number; percent: number };
  photos_count: number;
  materials_count: number;
  issues_open: number;
  display_status?: string;
  display_status_label?: string;
  works_total?: number;
  works_done?: number;
  overdue_days?: number;
  budget?: { planned: number; spent: number; variance: number };
  materials?: { total: number; delivered: number; need_buy: number; ordered: number };
};

export type WorkOrder = {
  id: string;
  project_id: string;
  room_id?: string | null;
  stage_id?: string | null;
  work_type: string;
  title: string;
  status: string;
  planned_start?: string | null;
  planned_end?: string | null;
  actual_start?: string | null;
  actual_end?: string | null;
  assignee_id?: string | null;
  chat_thread_id?: string | null;
  budget_planned: number;
  budget_spent: number;
  notes?: string | null;
  created_by?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type WorkAcceptance = {
  id: string;
  stage_id: string;
  stage_name?: string | null;
  status: string;
  quality_score?: number | null;
  requested_at?: string | null;
  accepted_at?: string | null;
  comment?: string | null;
  checklist?: StageChecklistItem[];
  /** API иногда не отдаёт progress на pending — UI обязан быть defensive */
  checklist_progress?: { done: number; total: number };
};
