/** Types mirror backend/app/api/v1/project_participants.py (w22 participant foundation). */
export type ParticipantScopeType = 'stage' | 'room' | 'work_type';

export interface ParticipantScope {
  scope_type: ParticipantScopeType;
  scope_ref: string;
}

export interface ProjectParticipant {
  id: string;
  user_id: string;
  full_name: string | null;
  participant_role: string;
  status: string;
  is_current_lead: boolean;
  all_scope: boolean;
  can_manage_schedule: boolean;
  can_manage_commercial: boolean;
  can_manage_documents: boolean;
  scopes: ParticipantScope[];
  added_at: string;
  removed_at: string | null;
}

export interface ParticipantMutation {
  participant: ProjectParticipant;
  created: boolean;
}
