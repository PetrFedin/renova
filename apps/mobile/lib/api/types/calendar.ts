/** Календарь и события */
import type { Stage } from './stage';

export type CalendarEvent = {
  id: string;
  kind: string;
  title: string;
  date: string;
  /** Конец периода этапа (stage_period) */
  end_date?: string;
  stage_id?: string;
  work_order_id?: string;
  room_id?: string;
  status?: string;
  amount?: number;
};

export type CalendarData = {
  project_id: string;
  planned_start: string | null;
  planned_end: string | null;
  events: CalendarEvent[];
  stages: Stage[];
};
