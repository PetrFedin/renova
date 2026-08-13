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
  /** Canonical stage read-model exposes workflow completion as a percent. */
  checklist_progress?: number;
};

export type StageChecklistItem = { id: string; text: string; done: boolean };

/** Server-authoritative actor capabilities for one stage. */
export type StageCapabilities = {
  can_schedule: boolean;
  can_start: boolean;
  can_submit_for_review: boolean;
  can_review: boolean;
};

/** Canonical `/projects/{id}/work-acceptances` wire shape. */
export type WorkAcceptance = {
  id: string;
  project_id: string;
  room_id: string | null;
  stage_id: string;
  requested_by: string | null;
  accepted_by: string | null;
  requested_at: string | null;
  accepted_at: string | null;
  status: 'not_requested' | 'requested' | 'in_review' | 'accepted' | 'accepted_with_remarks' | 'returned' | 'rejected' | string;
  checklist: unknown[];
  quality_score: number | null;
  comment: string | null;
  created_at: string | null;
  /** Mutation-only response metadata; absent from list responses. */
  replayed?: boolean;
  payment_id?: string | null;
  next_stage_id?: string | null;
  issue_id?: string | null;
  rework_deadline?: string | null;
};

export type StagePhoto = {
  id: string;
  caption: string | null;
  created_at: string;
  image_url: string | null;
  has_image: boolean;
};

export type StageDetail = Stage & {
  notes: string | null;
  contractor_ready_at: string | null;
  comments: { id: string; text: string; author_role: string; created_at: string }[];
  photos: StagePhoto[];
  /**
   * Optional only because cached pre-capability payloads can still exist on devices.
   * UI write actions must treat a missing capability set as denied/fail-closed.
   */
  capabilities?: StageCapabilities;
};

export type ProjectPlan = {
  project_id: string;
  name: string;
  property_type: string;
  planned_start_date: string | null;
  planned_end_date: string | null;
  stages: StageDetail[];
};
