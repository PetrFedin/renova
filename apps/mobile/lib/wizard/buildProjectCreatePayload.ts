/** Payload для POST /api/v1/projects — только поля ProjectCreate + rooms[] */
import type { WizardRoomDraft } from '@/constants/roomTypes';

export type WizardProjectDraft = {
  name: string;
  address?: string;
  renovation_type?: string;
  property_type?: 'apartment' | 'house';
  planned_start_date?: string;
  planned_end_date?: string;
  rooms: WizardRoomDraft[];
};

function normalizeRoom(r: WizardRoomDraft, index: number) {
  return {
    name: (r.name || '').trim() || `Комната ${index + 1}`,
    room_type: r.room_type || 'other',
    floor_level: r.floor_level ?? 1,
    length_m: r.length_m > 0 ? r.length_m : 3,
    width_m: r.width_m > 0 ? r.width_m : 3,
    height_m: r.height_m > 0 ? r.height_m : 2.7,
    outlets_count: r.outlets_count ?? 0,
    switches_count: r.switches_count ?? 0,
    plumbing_points: r.plumbing_points ?? 0,
  };
}

export function buildProjectCreatePayload(draft: WizardProjectDraft) {
  const rooms = (draft.rooms?.length ? draft.rooms : [{ name: 'Комната', length_m: 4, width_m: 3, height_m: 2.7 }]).map(
    normalizeRoom,
  );
  const area = rooms.reduce((sum, r) => sum + r.length_m * r.width_m, 0);
  const start = draft.planned_start_date?.trim();
  const end = draft.planned_end_date?.trim();

  return {
    name: draft.name.trim(),
    address: draft.address?.trim() || undefined,
    renovation_type: draft.renovation_type || 'cosmetic',
    property_type: draft.property_type || 'apartment',
    planned_start_date: start || undefined,
    planned_end_date: end || undefined,
    total_area_sqm: area > 0 ? Math.round(area * 10) / 10 : undefined,
    rooms,
  };
}
