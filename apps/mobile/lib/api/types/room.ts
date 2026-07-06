/** Комнаты и снимки */
export type Room = {
  id: string;
  name: string;
  room_type: string | null;
  floor_level?: number;
  length_m: number;
  width_m: number;
  height_m: number;
  openings_sq_m: number;
  outlets_count: number;
  switches_count: number;
  plumbing_points: number;
  notes: string | null;
  floor_sq_m: number;
  wall_sq_m: number;
  perimeter_m: number;
  is_archived?: boolean;
};

export type RoomStageCard = {
  id: string;
  name: string;
  sort_order: number;
  status: string;
  display_status: string;
  display_status_label: string;
  works_total: number;
  works_done: number;
  percent_complete: number;
  planned_start?: string | null;
  planned_end?: string | null;
  overdue_days: number;
  blocked: boolean;
  is_current: boolean;
  is_future: boolean;
  is_done: boolean;
  next_action: { title: string; button: string; kind: string; href: string };
};

export type RoomSnapshot = {
  id: string;
  name: string;
  room_type?: string | null;
  floor_level?: number;
  metrics: { floor_sq_m: number; wall_sq_m: number; perimeter_m: number; height_m: number };
  budget: { planned: number; spent: number; remaining: number; overrun: number };
  progress_percent: number;
  works_total: number;
  works_done: number;
  works_active?: string | null;
  materials_total: number;
  materials_need_buy: number;
  materials_delivered: number;
  issues_open: number;
  issues_critical: number;
  estimate_lines: number;
  next_action: { title: string; button: string; kind: string; href: string };
  stages?: RoomStageCard[];
  works: { id: string; name: string; status: string; percent_complete: number; planned_end?: string | null }[];
  materials: { id: string; name: string; status: string; qty_needed?: number; qty_delivered?: number }[];
};

export type RoomChangeRequest = {
  id: string;
  room_id: string;
  status: string;
  message: string;
  payload: Record<string, unknown> | null;
  created_at: string;
};
